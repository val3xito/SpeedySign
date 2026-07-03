/**
 * signingService.ts
 * Orchestrates IPA signing with zsign-rs and the original zhlynn/zsign CLI.
 */

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { secureDelete } from '../utils/secureDelete';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const SERVER_ROOT = (IS_PRODUCTION || __dirname.includes('dist'))
    ? path.resolve(__dirname, '..', '..')
    : path.resolve(__dirname, '..');

const BIN_DIR       = path.join(SERVER_ROOT, 'bin');
const ZSIGN_RS_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'zsign-rs.exe' : 'zsign-rs');
const ZSIGN_PATH    = path.join(BIN_DIR, process.platform === 'win32' ? 'zsign.exe' : 'zsign');

const ZSIGN_RS_SENSITIVE_ARG_FLAGS = new Set(['--password']);
const ZSIGN_SENSITIVE_ARG_FLAGS    = new Set(['-p', '--password']);

export type SignerType = 'auto' | 'zsign-rs' | 'zsign';
type ConcreteSignerType = Exclude<SignerType, 'auto'>;

export interface SignOptions {
    inputPath:          string;
    outputPath:         string;
    bundleId?:          string;
    p12Path:            string;
    p12Pass:            string;
    provisionPath:      string;
    appName:            string;
    signerPref:         SignerType;
    userId?:            string;
    customName?:        string;
    customVersion?:     string;
    entitlementsPath?:  string;
    sha256Only?:        boolean;
    compressionLevel?:  number;
    dylibPaths?:        string[];
    weakDylibPaths?:    string[];
}

export interface SigningResult {
    success:    boolean;
    outputPath: string;
    signerUsed: string;
}

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
            user_id:       userId    || 'unknown',
            ip_address:    ipAddress || 'unknown',
            app_name:      appName,
            bundle_id:     bundleId || 'default',
            signer_used:   signerUsed,
            mode,
            status:        success ? 'success' : 'error',
            error_message: errorMessage || null,
        });
    } catch {
        // Logging must never block signing.
    }
}

function collectSensitiveValues(args: string[], sensitiveArgFlags: Set<string>): string[] {
    const values: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (sensitiveArgFlags.has(args[i]) && args[i + 1]) {
            values.push(args[i + 1]);
            i++;
        }
    }
    return values.filter(Boolean);
}

function redactText(text: string, args: string[], sensitiveArgFlags: Set<string>): string {
    let redacted = text || '';
    for (const value of collectSensitiveValues(args, sensitiveArgFlags)) {
        redacted = redacted.split(value).join('[redacted]');
    }
    return redacted.replace(/pass:[^\s'"]+/g, 'pass:[redacted]');
}

function redactArgsForLog(args: string[], sensitiveArgFlags: Set<string>): string {
    const visible: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (sensitiveArgFlags.has(arg)) {
            visible.push(arg, '[redacted]');
            i++;
            continue;
        }
        visible.push(arg);
    }
    return visible.slice(0, 12).join(' ');
}

function runTool(
    toolPath: string,
    args: string[],
    toolName: string,
    signal: AbortSignal | undefined,
    sensitiveArgFlags: Set<string>
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Cancelled'));

        if (!fs.existsSync(toolPath)) {
            return reject(new Error(`${toolName} no encontrado en ${toolPath}`));
        }

        console.log(`  [SpeedySign] ${toolName} ${redactArgsForLog(args, sensitiveArgFlags)}...`);

        const proc = execFile(toolPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (stdout) {
                console.log(`  [SpeedySign] ${toolName} stdout:\n${redactText(stdout, args, sensitiveArgFlags)}`);
            }
            if (stderr) {
                console.warn(`  [SpeedySign] ${toolName} stderr:\n${redactText(stderr, args, sensitiveArgFlags)}`);
            }
            if (error) {
                if (signal?.aborted) return reject(new Error('Cancelled'));
                const details = redactText(stderr || stdout || error.message, args, sensitiveArgFlags);
                return reject(new Error(`Fallo en ${toolName}: ${details}`));
            }
            resolve();
        });

        signal?.addEventListener('abort', () => {
            try { proc.kill('SIGTERM'); } catch {}
            reject(new Error('Cancelled'));
        }, { once: true });
    });
}

/**
 * Convierte un certificado P12 a formato legacy para compatibilidad con zsign C++.
 * Los certificados modernos usan cifrado PKCS#12 con algoritmos que zsign C++ no entiende.
 * Sin esta conversión, zsign firma sin error pero produce firmas inválidas que iOS rechaza.
 */
async function convertP12ToLegacy(p12Path: string, password: string): Promise<string> {
    return new Promise((resolve) => {
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
                if (fs.existsSync(pemPath)) secureDelete(pemPath);

                if (err2 || !fs.existsSync(legacyPath)) {
                    console.warn(`  [SpeedySign] No se pudo re-empaquetar el P12 legacy: ${err2?.message || 'archivo no generado'}`);
                    return resolve(p12Path);
                }
                console.log('  [SpeedySign] P12 convertido a formato legacy para zsign C++');
                resolve(legacyPath);
            });
        });
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

function buildZsignArgs(opts: SignOptions): string[] {
    const args: string[] = [
        '-k', opts.p12Path,
        '-p', opts.p12Pass || '',
        '-m', opts.provisionPath,
        '-o', opts.outputPath,
    ];
    if (opts.bundleId) {
        args.push('-b', opts.bundleId);
    }
    if (opts.customName) {
        args.push('-n', opts.customName);
    }
    if (opts.customVersion) {
        args.push('-r', opts.customVersion);
    }
    if (opts.entitlementsPath && fs.existsSync(opts.entitlementsPath)) {
        args.push('-e', opts.entitlementsPath);
    }
    if (opts.sha256Only) {
        args.push('--sha256_only');
    }
    if (opts.compressionLevel != null && opts.compressionLevel >= 0 && opts.compressionLevel <= 9) {
        args.push('-z', String(opts.compressionLevel));
    }
    for (const dylibPath of opts.dylibPaths || []) {
        if (fs.existsSync(dylibPath)) args.push('-l', dylibPath);
    }
    for (const weakDylibPath of opts.weakDylibPaths || []) {
        if (fs.existsSync(weakDylibPath)) args.push('-w', weakDylibPath);
    }
    args.push(opts.inputPath);
    return args;
}

function getSignerOrder(signerPref: SignerType): ConcreteSignerType[] {
    if (signerPref === 'zsign') return ['zsign'];
    if (signerPref === 'zsign-rs') return ['zsign-rs'];
    return ['zsign-rs', 'zsign'];
}

function getSignerToolPath(signer: ConcreteSignerType): string {
    return signer === 'zsign-rs' ? ZSIGN_RS_PATH : ZSIGN_PATH;
}

function getSignerArgs(signer: ConcreteSignerType, opts: SignOptions): string[] {
    return signer === 'zsign-rs' ? buildZsignRsArgs(opts) : buildZsignArgs(opts);
}

function getSignerSensitiveArgFlags(signer: ConcreteSignerType): Set<string> {
    return signer === 'zsign-rs' ? ZSIGN_RS_SENSITIVE_ARG_FLAGS : ZSIGN_SENSITIVE_ARG_FLAGS;
}

function getUnsupportedReason(signer: ConcreteSignerType, opts: SignOptions): string | null {
    if (
        signer === 'zsign-rs' &&
        (
            (opts.entitlementsPath && fs.existsSync(opts.entitlementsPath)) ||
            (opts.dylibPaths && opts.dylibPaths.length > 0) ||
            (opts.weakDylibPaths && opts.weakDylibPaths.length > 0)
        )
    ) {
        return 'El motor zsign-rs (Rust) no soporta entitlements personalizados o inyeccion de dylibs.';
    }
    return null;
}

export async function executeSign(
    options: SignOptions,
    signal?: AbortSignal,
    ipAddress?: string
): Promise<SigningResult> {
    const { appName, bundleId, userId = 'unknown' } = options;
    const ip = ipAddress || 'unknown';
    const signerPref = options.signerPref || 'auto';
    const signerOrder = getSignerOrder(signerPref);
    const mode = signerPref === 'auto' ? 'auto' : 'manual';
    const errors: string[] = [];

    // Para zsign C++: convertir P12 a formato legacy si es necesario
    let legacyP12Path: string | null = null;
    const cleanupLegacyP12 = () => {
        if (legacyP12Path && legacyP12Path !== options.p12Path && fs.existsSync(legacyP12Path)) {
            secureDelete(legacyP12Path);
        }
    };

    console.log(`\n[SpeedySign] Firmando "${appName}" con motor ${signerPref}`);

    try {
        for (const signer of signerOrder) {
            const toolPath = getSignerToolPath(signer);
            const unsupportedReason = getUnsupportedReason(signer, options);

            if (unsupportedReason) {
                console.warn(`  [SpeedySign] Saltando ${signer}: ${unsupportedReason}`);
                errors.push(`${signer}: ${unsupportedReason}`);
                continue;
            }

            if (!fs.existsSync(toolPath)) {
                const missingMessage = `${signer} no encontrado en el servidor`;
                console.warn(`  [SpeedySign] ${missingMessage}`);
                errors.push(missingMessage);
                continue;
            }

            try {
                if (fs.existsSync(options.outputPath)) {
                    fs.unlinkSync(options.outputPath);
                }

                // Para zsign C++: convertir el P12 a formato legacy
                let signerOptions = options;
                if (signer === 'zsign' && !legacyP12Path) {
                    legacyP12Path = await convertP12ToLegacy(options.p12Path, options.p12Pass || '');
                    if (legacyP12Path !== options.p12Path) {
                        signerOptions = { ...options, p12Path: legacyP12Path };
                    }
                } else if (signer === 'zsign' && legacyP12Path && legacyP12Path !== options.p12Path) {
                    signerOptions = { ...options, p12Path: legacyP12Path };
                }

                await runTool(
                    toolPath,
                    getSignerArgs(signer, signerOptions),
                    signer,
                    signal,
                    getSignerSensitiveArgFlags(signer)
                );
                await logSigningAttempt(userId, ip, appName, bundleId || '', signer, mode, true);
                cleanupLegacyP12();
                return { success: true, outputPath: options.outputPath, signerUsed: signer };
            } catch (e: any) {
                if (e.message === 'Cancelled') throw e;
                const message = e.message || `Fallo en ${signer}`;
                console.warn(`  [SpeedySign] Fallo en ${signer}: ${message}`);
                errors.push(message);
                await logSigningAttempt(userId, ip, appName, bundleId || '', signer, mode, false, message);
            }
        }

        console.error(`  [SpeedySign] Error interno de firma: ${errors.join(' | ')}`);
        throw new Error(IS_PRODUCTION ? 'Error al firmar la app' : errors.join(' | '));
    } finally {
        cleanupLegacyP12();
    }
}
