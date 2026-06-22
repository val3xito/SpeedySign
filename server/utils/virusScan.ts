/**
 * virusScan.ts
 * Utilidad para escanear archivos en busca de virus usando ClamAV (clamscan) en el servidor SpeedySign.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Escanea un archivo en busca de virus ejecutando clamscan en el servidor.
 * 
 * Códigos de salida estándar de clamscan:
 *   - 0: No virus found.
 *   - 1: Virus(es) found.
 *   - 2: An error occurred (e.g. database not loaded, command failed, etc.).
 * 
 * Si clamscan no está instalado (por ejemplo en entornos locales de desarrollo),
 * la ejecución lanzará una excepción con código 'ENOENT'. Aplicamos un fail-open
 * de desarrollo local para no romper el flujo de desarrollo.
 * 
 * @param filePath - Ruta absoluta del archivo a escanear.
 * @returns true si el archivo está limpio o ClamAV no está instalado/falla. false si se detectó un virus.
 */
export function scanFileForVirus(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
        if (!filePath || !fs.existsSync(filePath)) {
            console.error(`[SpeedySign Antivirus] Archivo no encontrado para escaneo: ${filePath}`);
            // No podemos escanear un archivo inexistente, pero para evitar falsos positivos
            // de seguridad que rompan el servidor, resolvemos false aquí
            return resolve(false);
        }

        const fileName = path.basename(filePath);
        console.log(`[SpeedySign Antivirus] Iniciando escaneo de virus para: ${fileName}...`);

        execFile("clamscan", [filePath], { maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
            if (error) {
                // ENOENT: El comando clamscan no existe
                if (error.code === "ENOENT") {
                    console.warn(
                        `[SpeedySign Antivirus] ⚠️ ClamAV (clamscan) no está instalado en este sistema. ` +
                        `Omitiendo escaneo de virus para "${fileName}" (fail-open activado).`
                    );
                    return resolve(true);
                }

                // Código de salida 1: Virus detectado
                if (error.code === 1) {
                    console.error(`[SpeedySign Antivirus] ❌ ¡AMENAZA DETECTADA! El archivo "${fileName}" contiene malware.`);
                    console.error(`[SpeedySign Antivirus] Detalle de clamscan:\n${stdout}`);
                    return resolve(false);
                }

                // Otro código de error (ej. error 2: configuración o base de datos de firmas no cargada)
                console.warn(
                    `[SpeedySign Antivirus] ⚠️ Error al ejecutar clamscan en "${fileName}" ` +
                    `(Código de salida: ${error.code}, Mensaje: ${error.message}). ` +
                    `Omitiendo escaneo de virus (fail-open por error de configuración).`
                );
                if (stderr) {
                    console.warn(`[SpeedySign Antivirus] Detalle stderr: ${stderr}`);
                }
                return resolve(true);
            }

            // Exito: clamscan devolvió 0
            console.log(`[SpeedySign Antivirus] 🛡️ Escaneo exitoso: "${fileName}" está limpio de amenazas.`);
            resolve(true);
        });
    });
}
