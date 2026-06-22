/**
 * virusScan.ts
 * Utilidad para escanear archivos en busca de virus en el servidor SpeedySign.
 *
 * Pipeline de escaneo (en orden):
 *   1. VirusTotal hash lookup  — 70+ motores AV, instantáneo (solo hash SHA-256, sin subir el archivo)
 *   2. clamdscan               — ClamAV daemon local, rápido (<1s con daemon activo)
 *   3. clamscan                — ClamAV sin daemon, fallback lento
 *   4. fail-open               — Si todos los métodos fallan, se permite continuar
 */

import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el hash SHA-256 de un archivo para el lookup en VirusTotal.
 * Usamos ReadStream para no cargar archivos grandes en memoria de golpe.
 */
function computeSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}

interface VTResult {
    known: boolean;      // El archivo está en la base de datos de VT
    clean: boolean;      // Ningún motor lo marcó como malicioso/sospechoso
    malicious: number;   // Motores que lo marcan como malicioso
    suspicious: number;  // Motores que lo marcan como sospechoso
    total: number;       // Total de motores que lo analizaron
}

/**
 * Consulta la API de VirusTotal v3 usando el hash SHA-256 del archivo.
 * NO sube el archivo — solo realiza un hash lookup.
 * Retorna null si la API no está configurada o falla (fail-open para VT).
 */
async function checkVirusTotal(hash: string, fileName: string): Promise<VTResult | null> {
    const apiKey = process.env.VIRUSTOTAL_API_KEY;
    if (!apiKey) return null;

    console.log(`[SpeedySign Antivirus] 🔍 Consultando VirusTotal para: ${fileName} (hash: ${hash.slice(0, 16)}...)`);

    try {
        const response = await fetch(`https://www.virustotal.com/api/v3/files/${hash}`, {
            headers: { "x-apikey": apiKey },
            signal: AbortSignal.timeout(10_000), // 10s timeout para la llamada HTTP
        });

        // 404 = archivo desconocido para VT → no es necesariamente malicioso
        if (response.status === 404) {
            console.log(`[SpeedySign Antivirus] ℹ️  VirusTotal: \"${fileName}\" es desconocido (no indexado). Continuando con ClamAV...`);
            return { known: false, clean: true, malicious: 0, suspicious: 0, total: 0 };
        }

        if (response.status === 401) {
            console.warn(`[SpeedySign Antivirus] ⚠️  API key de VirusTotal inválida. Continuando con ClamAV...`);
            return null;
        }

        if (response.status === 429) {
            console.warn(`[SpeedySign Antivirus] ⚠️  Límite de rate de VirusTotal alcanzado. Continuando con ClamAV...`);
            return null;
        }

        if (!response.ok) {
            console.warn(`[SpeedySign Antivirus] ⚠️  VirusTotal API error ${response.status}. Continuando con ClamAV...`);
            return null;
        }

        const data = await response.json() as any;
        const stats = data?.data?.attributes?.last_analysis_stats;

        if (!stats) {
            console.warn(`[SpeedySign Antivirus] ⚠️  Respuesta de VirusTotal inesperada. Continuando con ClamAV...`);
            return null;
        }

        const malicious  = (stats.malicious  ?? 0) as number;
        const suspicious = (stats.suspicious ?? 0) as number;
        const harmless   = (stats.harmless   ?? 0) as number;
        const undetected = (stats.undetected ?? 0) as number;
        const total = malicious + suspicious + harmless + undetected;

        return { known: true, clean: malicious === 0 && suspicious === 0, malicious, suspicious, total };

    } catch (err: any) {
        if (err.name === "TimeoutError" || err.name === "AbortError") {
            console.warn(`[SpeedySign Antivirus] ⚠️  VirusTotal no respondió en 10s. Continuando con ClamAV...`);
        } else {
            console.warn(`[SpeedySign Antivirus] ⚠️  Error consultando VirusTotal: ${err.message}. Continuando con ClamAV...`);
        }
        return null;
    }
}

/**
 * Ejecuta un comando de escaneo local (clamdscan/clamscan) con un timeout estricto.
 */
function runScanCommand(command: string, filePath: string, timeoutMs: number): Promise<{ success: boolean; skipFallback: boolean }> {
    return new Promise((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        let resolved = false;

        const proc = execFile(command, [filePath], { maxBuffer: 1024 * 1024 }, (error: any, stdout: string) => {
            if (timer) clearTimeout(timer);
            if (resolved) return;
            resolved = true;

            if (error) {
                // ENOENT: el comando no está instalado
                if (error.code === "ENOENT") {
                    return resolve({ success: false, skipFallback: false });
                }
                // Código 1: virus detectado
                if (error.code === 1) {
                    console.error(`[SpeedySign Antivirus] ❌ ¡AMENAZA DETECTADA por ${command}! El archivo \"${path.basename(filePath)}\" contiene malware.`);
                    console.error(`[SpeedySign Antivirus] Detalle del escaneo:\n${stdout}`);
                    return resolve({ success: false, skipFallback: true });
                }
                // Código 2 u otro: error de conexión al daemon o DB
                return resolve({ success: false, skipFallback: false });
            }

            // Éxito (exit code 0): archivo limpio
            console.log(`[SpeedySign Antivirus] 🛡️  Escaneo exitoso con ${command}: \"${path.basename(filePath)}\" está limpio.`);
            resolve({ success: true, skipFallback: true });
        });

        timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try { proc.kill("SIGTERM"); } catch {}
            console.warn(`[SpeedySign Antivirus] ⚠️  El escaneo con ${command} excedió el tiempo límite de ${timeoutMs / 1000}s. Forzando fail-open.`);
            resolve({ success: true, skipFallback: true });
        }, timeoutMs);
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Función principal exportada
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Umbral de detecciones maliciosas de VirusTotal para bloquear un archivo.
 * Por defecto: 3 motores. Configurable via VIRUSTOTAL_THRESHOLD env var.
 *
 * Usar un umbral > 1 evita falsos positivos de motores AV agresivos.
 * Ej: VIRUSTOTAL_THRESHOLD=1 para máxima seguridad (más falsos positivos).
 *     VIRUSTOTAL_THRESHOLD=5 para máxima tolerancia (menos bloqueos incorrectos).
 *
 * NOTA: Se lee dinámicamente dentro de la función para que cambios en proceso
 * (por ejemplo en tests) tengan efecto inmediato.
 */

/**
 * Escanea un archivo en busca de virus usando el siguiente pipeline:
 *   1. VirusTotal hash lookup (70+ motores AV, sin subir el archivo)
 *   2. clamdscan (daemon ClamAV local, rápido)
 *   3. clamscan (fallback lento sin daemon)
 *   4. fail-open (si todos los métodos fallan, se permite continuar)
 *
 * @param filePath - Ruta absoluta del archivo a escanear.
 * @returns true si el archivo está limpio o el escaneo no pudo completarse. false si se detectó malware.
 */
export async function scanFileForVirus(filePath: string): Promise<boolean> {
    // Leer el umbral dinámicamente en cada llamada (permite cambios en tests/runtime)
    const VT_THRESHOLD = parseInt(process.env.VIRUSTOTAL_THRESHOLD ?? "3", 10);
    // Bypass completo si el antivirus está desactivado por variable de entorno
    if (process.env.ENABLE_ANTIVIRUS === "false") {
        console.log(`[SpeedySign Antivirus] 🛡️  Antivirus desactivado por variable de entorno. Omitiendo escaneo.`);
        return true;
    }

    if (!filePath || !fs.existsSync(filePath)) {
        console.error(`[SpeedySign Antivirus] Archivo no encontrado para escaneo: ${filePath}`);
        return false;
    }

    const fileName = path.basename(filePath);
    const timeoutMs = 12_000; // 12 segundos para ClamAV

    console.log(`[SpeedySign Antivirus] Iniciando escaneo de virus para: ${fileName}...`);

    // ── Paso 1: VirusTotal hash lookup ────────────────────────────────────────
    if (process.env.VIRUSTOTAL_API_KEY) {
        try {
            const hash = await computeSHA256(filePath);
            const vtResult = await checkVirusTotal(hash, fileName);

            if (vtResult !== null && vtResult.known) {
                if (vtResult.malicious >= VT_THRESHOLD) {
                    console.error(
                        `[SpeedySign Antivirus] ❌ VirusTotal: \"${fileName}\" detectado como MALWARE` +
                        ` (${vtResult.malicious}/${vtResult.total} motores). Bloqueando firma.`
                    );
                    return false;
                }
                if (vtResult.suspicious >= VT_THRESHOLD) {
                    console.error(
                        `[SpeedySign Antivirus] ❌ VirusTotal: \"${fileName}\" detectado como SOSPECHOSO` +
                        ` (${vtResult.suspicious}/${vtResult.total} motores). Bloqueando firma.`
                    );
                    return false;
                }
                if (vtResult.malicious > 0 || vtResult.suspicious > 0) {
                    console.warn(
                        `[SpeedySign Antivirus] ⚠️  VirusTotal: \"${fileName}\" flaggeado por ` +
                        `${vtResult.malicious + vtResult.suspicious} motor(es) (por debajo del umbral de ${VT_THRESHOLD}). ` +
                        `Continuando con ClamAV para segunda opinión...`
                    );
                    // Continuamos a ClamAV para segunda opinión aunque haya alguna detección baja
                } else {
                    console.log(
                        `[SpeedySign Antivirus] ✅ VirusTotal: \"${fileName}\" limpio` +
                        ` (0/${vtResult.total} motores). Escaneo completado.`
                    );
                    return true; // Limpio según VT → no hace falta ClamAV
                }
            }
            // Si vtResult es null o not known → continuamos a ClamAV
        } catch (err: any) {
            console.warn(`[SpeedySign Antivirus] ⚠️  Error calculando hash SHA-256: ${err.message}. Continuando con ClamAV...`);
        }
    }

    // ── Paso 2: clamdscan (daemon ClamAV, rápido) ─────────────────────────────
    const clamdResult = await runScanCommand("clamdscan", filePath, timeoutMs);
    if (clamdResult.success) return true;
    if (clamdResult.skipFallback) return false; // Virus confirmado

    // ── Paso 3: clamscan (sin daemon, fallback lento) ─────────────────────────
    console.log(`[SpeedySign Antivirus] clamdscan no disponible o daemon inactivo. Reintentando con clamscan...`);
    const clamResult = await runScanCommand("clamscan", filePath, timeoutMs);
    if (clamResult.success) return true;
    if (clamResult.skipFallback) return false; // Virus confirmado

    // ── Paso 4: fail-open ─────────────────────────────────────────────────────
    console.warn(`[SpeedySign Antivirus] ⚠️  No se pudo completar el escaneo con ningún motor. Omitiendo escaneo (fail-open).`);
    return true;
}
