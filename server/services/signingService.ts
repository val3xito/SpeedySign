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
import { secureDelete } from '../utils/secureDelete';

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
const ZSIGN_PATH   = path.join(BIN_DIR, process.platform === 'win32' ? 'zsign.exe'   : 'zsign');
const ARKSIGN_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'arksign.exe' : 'arksign');
const SPEEDYSIGNER_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'speedysigner.exe' : 'speedysigner');
const ENABLE_SPEEDYSIGNER_EXPERIMENTAL = process.env.ENABLE_SPEEDYSIGNER_EXPERIMENTAL !== 'false';
const REQUIRE_SIGNING_VERIFICATION = process.env.DISABLE_SIGNING_VERIFICATION !== 'true';
const SENSITIVE_ARG_FLAGS = new Set(['-k', '-p', '-m', '-o', '-e', '-l', '-w']);

export type SignerType = 'auto' | 'zsign' | 'arksign' | 'speedysigner';

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

// ── Conversión P12 a formato legacy ───────────────────────────────────────────
/**
 * Convierte un P12 moderno (OpenSSL 3.x, AES-256/SHA-256) a formato legacy
 * compatible con zsign/arksign. Usa OpenSSL en el servidor.
 * Devuelve la ruta del P12 convertido, o la ruta original si falla.
 *
 * El archivo PEM intermedio se elimina con secureDelete (contiene la clave privada).
 */
async function convertP12ToLegacy(p12Path: string, password: string): Promise<string> {
    return new Promise((resolve) => {
        // UUID único por conversión para evitar colisiones cuando múltiples peticiones
        // concurrentes usan el mismo certificado del servidor (race condition).
        const uniqueId   = randomUUID();
        const dir        = path.dirname(p12Path);
        const legacyPath = path.join(dir, `${uniqueId}_legacy.p12`);
        const pemPath    = path.join(dir, `${uniqueId}_tmp.pem`);

        // Paso 1: P12 → PEM sin cifrar
        execFile('openssl', [
            'pkcs12', '-legacy',
            '-in',       p12Path,
            '-passin',   `pass:${password}`,
            '-nodes',
            '-out',      pemPath,
        ], { timeout: 5000 }, (err1) => {
            if (err1) {
                console.warn(`  [SpeedySign] No se pudo convertir el P12 a legacy: ${err1.code || err1.message}`);
                // openssl no disponible o P12 ya es legacy — usar original
                return resolve(p12Path);
            }
            // Paso 2: PEM → P12 legacy
            execFile('openssl', [
                'pkcs12', '-legacy',
                '-export',
                '-in',      pemPath,
                '-out',     legacyPath,
                '-passout', `pass:${password}`,
            ], { timeout: 5000 }, (err2) => {
                // El PEM contiene la clave privada en texto claro → eliminación segura
                secureDelete(pemPath);

                if (err2 || !fs.existsSync(legacyPath)) {
                    return resolve(p12Path); // fallback al original
                }
                console.log(`  🔑 P12 convertido a formato legacy`);
                resolve(legacyPath);
            });
        });
    });
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
        // Log sin mostrar los argumentos de contraseña (-p/-k/-m)
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

async function verifySignedOutput(opts: SignOptions, signal?: AbortSignal): Promise<void> {
    if (!REQUIRE_SIGNING_VERIFICATION) return;

    const verifierArgs = [
        '--verify',
        '-m', opts.provisionPath,
        ...(opts.bundleId ? ['-b', opts.bundleId] : []),
        opts.outputPath,
    ];

    await runTool(SPEEDYSIGNER_PATH, verifierArgs, 'speedysigner-verify', signal);
}

/**
 * Construye los argumentos CLI para zsign / arksign.
 * Ambas herramientas comparten la misma sintaxis básica.
 */
function buildArgs(opts: SignOptions): string[] {
    const args: string[] = [
        '-k', opts.p12Path,
        '-p', opts.p12Pass || '',
        '-m', opts.provisionPath,
        '-o', opts.outputPath,
    ];

    if (opts.bundleId)                          args.push('-b', opts.bundleId);
    if (opts.customName)                        args.push('-n', opts.customName);
    if (opts.customVersion)                     args.push('-r', opts.customVersion);
    if (opts.entitlementsPath && fs.existsSync(opts.entitlementsPath))
                                                args.push('-e', opts.entitlementsPath);
    if (opts.sha256Only)                        args.push('--sha256_only');
    if (opts.compressionLevel != null && opts.compressionLevel >= 0 && opts.compressionLevel <= 9)
                                                args.push('-z', String(opts.compressionLevel));

    for (const dl of (opts.dylibPaths     || [])) if (fs.existsSync(dl)) args.push('-l', dl);
    for (const dl of (opts.weakDylibPaths || [])) if (fs.existsSync(dl)) args.push('-w', dl);

    args.push(opts.inputPath);
    return args;
}

// ── Orquestador principal ─────────────────────────────────────────────────────
export async function executeSign(
    options: SignOptions,
    signal?: AbortSignal,
    ipAddress?: string
): Promise<SigningResult> {
    const { appName, bundleId, signerPref, userId = 'unknown' } = options;
    const ip = ipAddress || 'unknown';

    const speedysignerArgs = buildArgs(options);
    let resolvedP12: string | null = null;
    let fallbackArgs: string[] | null = null;
    const errors: string[] = [];

    const getFallbackArgs = async (): Promise<string[]> => {
        if (!fallbackArgs) {
            // zsign/arksign necesitan a veces P12 legacy. SpeedySigner no pasa por
            // esta conversion para evitar el coste de OpenSSL en el camino rapido.
            resolvedP12 = await convertP12ToLegacy(options.p12Path, options.p12Pass || '');
            const resolvedOptions = resolvedP12 !== options.p12Path
                ? { ...options, p12Path: resolvedP12 }
                : options;
            fallbackArgs = buildArgs(resolvedOptions);
        }
        return fallbackArgs;
    };

    // Limpiar el P12 legacy temporal (contiene clave privada) con secureDelete
    const cleanupLegacyP12 = () => {
        if (resolvedP12 && resolvedP12 !== options.p12Path && fs.existsSync(resolvedP12)) {
            secureDelete(resolvedP12);
        }
    };

    console.log(`\n⚙️  Firmando "${appName}" (signer: ${signerPref})`);
    if (options.sha256Only)         console.log('  ⚡ SHA-256 only activado');
    if (options.dylibPaths?.length) console.log(`  💉 Dylibs: ${options.dylibPaths.length}`);
    if (options.customName)         console.log(`  📝 Nombre: ${options.customName}`);
    if (options.customVersion)      console.log(`  🏷️  Versión: ${options.customVersion}`);

    const tryZsign        = async () => { try { await runTool(ZSIGN_PATH,        await getFallbackArgs(), 'zsign',        signal); return true; } catch (e: any) { if (e.message === 'Cancelled') throw e; errors.push(e.message); return false; } };
    const tryArksign      = async () => { try { await runTool(ARKSIGN_PATH,      await getFallbackArgs(), 'arksign',      signal); return true; } catch (e: any) { if (e.message === 'Cancelled') throw e; errors.push(e.message); return false; } };
    const trySpeedysigner = async () => { try { await runTool(SPEEDYSIGNER_PATH, speedysignerArgs,       'speedysigner', signal); await verifySignedOutput(options, signal); return true; } catch (e: any) { if (e.message === 'Cancelled') throw e; errors.push(e.message); return false; } };

    const zsignAvailable        = fs.existsSync(ZSIGN_PATH);
    const arksignAvailable      = fs.existsSync(ARKSIGN_PATH);
    const speedysignerAvailable = ENABLE_SPEEDYSIGNER_EXPERIMENTAL && fs.existsSync(SPEEDYSIGNER_PATH);

    if (!zsignAvailable && !arksignAvailable && !speedysignerAvailable) {
        throw new Error('No se encontró ningún motor de firma (zsign/arksign/speedysigner) en el servidor.');
    }

    // Manual: speedysigner (con fallback a zsign, luego arksign)
    if (signerPref === 'speedysigner') {
        if (!ENABLE_SPEEDYSIGNER_EXPERIMENTAL) {
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'speedysigner', 'manual', false, 'SpeedySigner experimental desactivado');
            cleanupLegacyP12();
            throw new Error('SpeedySigner está desactivado temporalmente: la firma generada no supera la verificación de integridad de iOS. Usa zsign mientras se corrige.');
        }
        if (speedysignerAvailable) {
            const ok = await trySpeedysigner();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'speedysigner', 'manual', ok, errors[0]);
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'speedysigner' }; }
        }
        if (zsignAvailable) {
            console.log('  ⚠️  speedysigner no disponible/falló → fallback a zsign...');
            const ok = await tryZsign();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'zsign', 'fallback', ok, errors.join(' | '));
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'zsign' }; }
        }
        if (arksignAvailable) {
            console.log('  ⚠️  zsign no disponible/falló → fallback a arksign...');
            const ok = await tryArksign();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'arksign', 'fallback', ok, errors.join(' | '));
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'arksign' }; }
        }
        cleanupLegacyP12();
        console.error(`  [SpeedySign] Error interno de firma con speedysigner: ${errors.join(' | ')}`);
        throw new Error(IS_PRODUCTION ? 'Error al firmar con speedysigner' : errors.join(' | '));
    }

    // Manual: zsign (con fallback a arksign, luego speedysigner)
    if (signerPref === 'zsign') {
        if (zsignAvailable) {
            const ok = await tryZsign();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'zsign', 'manual', ok, errors[0]);
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'zsign' }; }
        }
        if (arksignAvailable) {
            console.log('  ⚠️  zsign no disponible/falló → fallback a arksign...');
            const ok = await tryArksign();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'arksign', 'fallback', ok, errors.join(' | '));
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'arksign' }; }
        }
        if (speedysignerAvailable) {
            console.log('  ⚠️  arksign no disponible/falló → fallback a speedysigner...');
            const ok = await trySpeedysigner();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'speedysigner', 'fallback', ok, errors.join(' | '));
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'speedysigner' }; }
        }
        cleanupLegacyP12();
        console.error(`  [SpeedySign] Error interno de firma: ${errors.join(' | ')}`);
        throw new Error(IS_PRODUCTION ? 'Error al firmar con zsign' : errors.join(' | '));
    }

    // Manual: arksign (con fallback a zsign, luego speedysigner)
    if (signerPref === 'arksign') {
        if (arksignAvailable) {
            const ok = await tryArksign();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'arksign', 'manual', ok, errors[0]);
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'arksign' }; }
        }
        if (zsignAvailable) {
            console.log('  ⚠️  arksign no disponible/falló → fallback a zsign...');
            const ok = await tryZsign();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'zsign', 'fallback', ok, errors.join(' | '));
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'zsign' }; }
        }
        if (speedysignerAvailable) {
            console.log('  ⚠️  zsign no disponible/falló → fallback a speedysigner...');
            const ok = await trySpeedysigner();
            await logSigningAttempt(userId, ip, appName, bundleId || '', 'speedysigner', 'fallback', ok, errors.join(' | '));
            if (ok) { cleanupLegacyP12(); return { success: true, outputPath: options.outputPath, signerUsed: 'speedysigner' }; }
        }
        cleanupLegacyP12();
        console.error(`  [SpeedySign] Error interno de firma: ${errors.join(' | ')}`);
        throw new Error(IS_PRODUCTION ? 'Error al firmar con arksign' : errors.join(' | '));
    }

    // Auto: zsign primero. SpeedySigner queda como opcion manual hasta validar
    // compatibilidad y rendimiento con IPAs reales.
    let finalSigner = 'zsign';
    let success = false;

    if (zsignAvailable) {
        success = await tryZsign();
    }

    if (!success && arksignAvailable) {
        console.log('  ⚠️  zsign falló → fallback a arksign...');
        finalSigner = 'arksign';
        success = await tryArksign();
    }

    if (!success && speedysignerAvailable) {
        console.log('  ⚠️  arksign falló → fallback a speedysigner...');
        finalSigner = 'speedysigner';
        success = await trySpeedysigner();
    }

    await logSigningAttempt(userId, ip, appName, bundleId || '', finalSigner, 'auto', success, errors.join(' | '));
    cleanupLegacyP12();

    if (success) {
        console.log(`  ✅ Firmado con ${finalSigner}`);
        return { success: true, outputPath: options.outputPath, signerUsed: finalSigner };
    }

    console.error(`  [SpeedySign] Error interno de firma: ${errors.join(' | ')}`);
    throw new Error(IS_PRODUCTION
        ? 'El proceso de firma falló en todos los motores disponibles.'
        : `Errores: ${errors.join(' | ')}`);
}
