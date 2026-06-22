/**
 * virusScan.ts
 * Utilidad para escanear archivos en busca de virus usando ClamAV (clamdscan/clamscan) en el servidor SpeedySign.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Ejecuta un comando de escaneo de virus con un timeout estricto.
 */
function runScanCommand(command: string, filePath: string, timeoutMs: number): Promise<{ success: boolean; skipFallback: boolean }> {
    return new Promise((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        let resolved = false;

        const proc = execFile(command, [filePath], { maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
            if (timer) clearTimeout(timer);
            if (resolved) return;
            resolved = true;

            if (error) {
                // ENOENT: El comando no está instalado
                if (error.code === "ENOENT") {
                    return resolve({ success: false, skipFallback: false }); // Intentar fallback
                }
                // Código de salida 1: Virus detectado
                if (error.code === 1) {
                    console.error(`[SpeedySign Antivirus] ❌ ¡AMENAZA DETECTADA por ${command}! El archivo "${path.basename(filePath)}" contiene malware.`);
                    console.error(`[SpeedySign Antivirus] Detalle del escaneo:\n${stdout}`);
                    return resolve({ success: false, skipFallback: true }); // No intentar fallback
                }
                // Código de salida 2 u otro error de conexión al daemon (ej. clamd no responde)
                return resolve({ success: false, skipFallback: false }); // Intentar fallback
            }

            // Exito: clamscan/clamdscan devolvió 0
            console.log(`[SpeedySign Antivirus] 🛡️ Escaneo exitoso con ${command}: "${path.basename(filePath)}" está limpio.`);
            resolve({ success: true, skipFallback: true });
        });

        timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try {
                proc.kill("SIGTERM");
            } catch {}
            console.warn(`[SpeedySign Antivirus] ⚠️ El escaneo con ${command} excedió el tiempo límite de ${timeoutMs / 1000}s. Forzando fail-open.`);
            resolve({ success: true, skipFallback: true }); // Abortar fallback y forzar éxito
        }, timeoutMs);
    });
}

/**
 * Escanea un archivo en busca de virus ejecutando clamdscan (primero) o clamscan (segundo).
 * 
 * @param filePath - Ruta absoluta del archivo a escanear.
 * @returns true si el archivo está limpio, si el escaneo expira o si ClamAV no está instalado/falla. false si se detectó un virus.
 */
export async function scanFileForVirus(filePath: string): Promise<boolean> {
    if (process.env.ENABLE_ANTIVIRUS === "false") {
        console.log(`[SpeedySign Antivirus] 🛡️ Antivirus desactivado por variable de entorno. Omitiendo escaneo.`);
        return true;
    }

    if (!filePath || !fs.existsSync(filePath)) {
        console.error(`[SpeedySign Antivirus] Archivo no encontrado para escaneo: ${filePath}`);
        return false;
    }

    const fileName = path.basename(filePath);
    const timeoutMs = 12000; // 12 segundos

    console.log(`[SpeedySign Antivirus] Iniciando escaneo de virus para: ${fileName}...`);

    // 1. Intentar clamdscan (rápido mediante demonio en segundo plano)
    const clamdResult = await runScanCommand("clamdscan", filePath, timeoutMs);
    if (clamdResult.success) {
        return true;
    }
    if (clamdResult.skipFallback) {
        return false; // Virus real detectado
    }

    // 2. Intentar clamscan (lento sin demonio, cargando DB a disco)
    console.log(`[SpeedySign Antivirus] clamdscan no disponible o daemon inactivo. Reintentando con clamscan...`);
    const clamResult = await runScanCommand("clamscan", filePath, timeoutMs);
    if (clamResult.success) {
        return true;
    }
    if (clamResult.skipFallback) {
        return false; // Virus real detectado
    }

    // Si ambos motores de escaneo fallaron/no están instalados
    console.warn(`[SpeedySign Antivirus] ⚠️ No se pudo completar el escaneo de virus con ningún motor de ClamAV. Omitiendo escaneo (fail-open).`);
    return true;
}
