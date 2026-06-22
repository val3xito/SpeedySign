/**
 * signingService.ts
 * Orquestador de firma con zsign / arksign.
 * Soporta flags extendidos: --sha256_only, -z (compresión), -n (nombre),
 * -r (versión), -e (entitlements), -l (dylib), -w (dylib débil).
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ── Supabase logging ──────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const SERVER_ROOT  = (IS_PRODUCTION || __dirname.includes('dist'))
    ? path.resolve(__dirname, '..', '..')
    : path.resolve(__dirname, '..');

const BIN_DIR      = path.join(SERVER_ROOT, 'bin');
const ZSIGN_RS_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'zsign-rs.exe' : 'zsign-rs');
const SENSITIVE_ARG_FLAGS = new Set(['--password']);

export type SignerType = 'auto' | 'zsign-rs';

export interface SignOptions {
    inputPath:          string;
    outputPath:         string;
    bundleId?:          string;
    p12Path:            string;
    p12Pass:            string;
    provisionPath:      string;
    appName:            string;
    signerPref:         SignerType;
    userId?:            string;   // Para auditoría
    // ── Opciones extendidas ──────────────────────────────────────────────────
    /** Override del nombre visible de la app (-n) */
    customName?:        string;
    /** Override de versión (-r) */
    customVersion?:     string;
    /** Ruta a archivo .entitlements personalizado (-e) */
    entitlementsPath?:  string;
    /** SHA-256 only para compatibilidad con dispositivos modernos (--sha256_only) */
    sha256Only?:        boolean;
    /** Nivel de compresión ZIP 0-9 (-z) */
    compressionLevel?:  number;
    /** Rutas a .dylib a inyectar fuerte (-l) */
    dylibPaths?:        string[];
    /** Rutas a .dylib a inyectar débil (-w) */
    weakDylibPaths?:    string[];
}

export interface SigningResult {
    success:    boolean;
    outputPath: string;
    signerUsed: string;
}

// ── Logging ───────────────────────────────────────────────────────────────────
/**
 * Registra el intento de firma en la tabla signing_logs de Supabase.
 * Los campos user_id e ip_address requieren que existan en la tabla;
 * si no existen, el insert falla silenciosamente (catch vacío).
 */
async function logSigningAttempt(
    userId:       string,
    ipAddress:    string,
    appName:      string,
    bundleId:     string,
    signerUsed:   string,
    mode:         string,
    success:      boolean,
    errorMessage?: string
) {
    if (!supabase) return;
    try {
        await supabase.from('signing_logs').insert({
            user_id:       userId   || 'unknown',
            ip_address:    ipAddress || 'unknown',
            app_name:      appName,
            bundle_id:     bundleId || 'default',
            signer_used:   signerUsed,
            mode,
            status:        success ? 'success' : 'error',
            error_message: errorMessage || null,
        });
    } catch { /* no-op — columnas pueden no existir todavía */ }
}

// ── CLI runner ────────────────────────────────────────────────────────────────
function collectSensitiveValues(args: string[]): string[] {
    const values: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (SENSITIVE_ARG_FLAGS.has(args[i]) && args[i + 1]) {
            values.push(args[i + 1]);
            i++;
        }
    }
    return values.filter(Boolean);
}

function redactText(text: string, args: string[]): string {
    let redacted = text || '';
    for (const value of collectSensitiveValues(args)) {
        redacted = redacted.split(value).join('[redacted]');
    }
    return redacted.replace(/pass:[^\s'"]+/g, 'pass:[redacted]');
}

function redactArgsForLog(args: string[]): string {
    const visible: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (SENSITIVE_ARG_FLAGS.has(arg)) {
            visible.push(arg, '[redacted]');
            i++;
            continue;
        }
        visible.push(arg);
    }
    return visible.slice(0, 10).join(' ');
}

function runTool(toolPath: string, args: string[], toolName: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error("Cancelled"));

        if (!fs.existsSync(toolPath)) {
            return reject(new Error(`${toolName} no encontrado en ${toolPath}`));
        }
        // Log sin mostrar los argumentos de contraseña
        console.log(`  [SpeedySign] ${toolName} ${redactArgsForLog(args)}...`);

        const proc = execFile(toolPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                if (signal?.aborted) return reject(new Error("Cancelled"));
                const details = redactText(stderr || stdout || error.message, args);
                return reject(new Error(`Fallo en ${toolName}: ${details}`));
            }
            resolve();
        });

        signal?.addEventListener("abort", () => {
            try { proc.kill("SIGTERM"); } catch { }
            reject(new Error("Cancelled"));
        }, { once: true });
    });
}

function buildZsignRsArgs(opts: SignOptions): string[] {
    const args: string[] = [
        '-p', opts.p12Path,
        '-m', opts.provisionPath,
        '-o', opts.outputPath,
    ];
    if (opts.p12Pass) {
        args.push('--password', opts.p12Pass);
    }
    if (opts.bundleId) {
        args.push('-b', opts.bundleId);
    }
    if (opts.compressionLevel != null && opts.compressionLevel >= 0 && opts.compressionLevel <= 9) {
        args.push('-z', String(opts.compressionLevel));
    }
    args.push(opts.inputPath);
    return args;
}

// ── Orquestador principal ─────────────────────────────────────────────────────
export async function executeSign(
    options: SignOptions,
    signal?: AbortSignal,
    ipAddress?: string
): Promise<SigningResult> {
    const { appName, bundleId, userId = 'unknown' } = options;
    const ip = ipAddress || 'unknown';

    const zsignRsArgs = buildZsignRsArgs(options);
    const errors: string[] = [];

    console.log(`\n⚙️  Firmando "${appName}" con zsign-rs`);
    if (options.sha256Only)         console.log('  ⚡ SHA-256 only activado (no-op para zsign-rs)');

    const tryZsignRs = async () => { 
        try { 
            await runTool(ZSIGN_RS_PATH, zsignRsArgs, 'zsign-rs', signal); 
            return true; 
        } catch (e: any) { 
            if (e.message === 'Cancelled') throw e; 
            console.warn(`  [SpeedySign] Fallo en zsign-rs: ${e.message}`); 
            errors.push(e.message); 
            return false; 
        } 
    };

    const zsignRsAvailable = fs.existsSync(ZSIGN_RS_PATH);

    if (!zsignRsAvailable) {
        throw new Error('No se encontró el motor de firma zsign-rs (Rust) en el servidor.');
    }

    if (
        (options.entitlementsPath && fs.existsSync(options.entitlementsPath)) ||
        (options.dylibPaths && options.dylibPaths.length > 0) ||
        (options.weakDylibPaths && options.weakDylibPaths.length > 0)
    ) {
        throw new Error("El motor zsign-rs (Rust) no soporta entitlements personalizados o inyección de dylibs.");
    }

    const ok = await tryZsignRs();
    await logSigningAttempt(userId, ip, appName, bundleId || '', 'zsign-rs', 'manual', ok, errors[0]);

    if (ok) { 
        return { success: true, outputPath: options.outputPath, signerUsed: 'zsign-rs' }; 
    }

    console.error(`  [SpeedySign] Error interno de firma con zsign-rs: ${errors.join(' | ')}`);
    throw new Error(IS_PRODUCTION ? 'Error al firmar con zsign-rs' : errors.join(' | '));
}

