/**
 * cleanup.ts
 * Limpieza de archivos temporales y firmados en el servidor SpeedySign.
 */

import fs from "fs";
import path from "path";
import { secureDelete } from "./secureDelete";

/**
 * Extensiones de archivos sensibles que requieren sobreescritura segura antes de borrar.
 * Usar secureDelete en lugar de fs.unlinkSync para evitar recuperación forense.
 */
const SENSITIVE_EXTS = new Set([".p12", ".pem", ".mobileprovision"]);

/**
 * Limpia archivos temporales de TEMP_DIR más antiguos de 1 hora.
 * Usa secureDelete para archivos que puedan contener claves privadas (.p12, .pem, .mobileprovision).
 */
export function cleanupTempFiles(tempDir: string): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    try {
        const files = fs.readdirSync(tempDir);
        files.forEach((file) => {
            const filePath = path.join(tempDir, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.mtimeMs < oneHourAgo) {
                    const ext = path.extname(file).toLowerCase();
                    if (SENSITIVE_EXTS.has(ext)) {
                        // Sobreescribir con ceros antes de borrar (contiene claves privadas)
                        secureDelete(filePath);
                    } else {
                        fs.unlinkSync(filePath);
                    }
                    console.log(`[SpeedySign] Temp limpiado: ${file}`);
                }
            } catch { }
        });
    } catch { }
}

/**
 * Limpia IPAs firmados de SIGNED_DIR con más de 3 minutos de antigüedad.
 * 3 minutos da tiempo suficiente para que iOS descargue e instale la app 
 * mediante OTA sin saturar el almacenamiento del servidor.
 * (Valor anterior: 5 minutos)
 */
export function cleanupSignedFiles(signedDir: string): void {
    const threeMinutesAgo = Date.now() - 3 * 60 * 1000;
    try {
        const files = fs.readdirSync(signedDir);
        files.forEach((file) => {
            const filePath = path.join(signedDir, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.mtimeMs < threeMinutesAgo) {
                    fs.unlinkSync(filePath);
                    console.log(`[SpeedySign] IPA expirado eliminado: ${file}`);
                }
            } catch { }
        });
    } catch { }
}

/**
 * Limpia todos los IPAs firmados al arrancar el servidor.
 * Los IPAs firmados de sesiones anteriores no son accesibles tras el reinicio
 * porque las URLs se pierden; borrarlos libera espacio.
 */
export function cleanupSignedOnStartup(signedDir: string): void {
    try {
        const files = fs.readdirSync(signedDir);
        files.forEach((file) => {
            const filePath = path.join(signedDir, file);
            try { fs.unlinkSync(filePath); } catch { }
        });
        if (files.length > 0) {
            console.log(`[SpeedySign] Limpiados ${files.length} IPA(s) firmados al arrancar.`);
        }
    } catch { }
}

/**
 * Limpia archivos temporales huérfanos de sesiones anteriores al arrancar.
 * Si el servidor fue SIGKILL'd durante una firma, los archivos .p12/.pem
 * quedan en TEMP_DIR. Se eliminan con secureDelete en el arranque.
 */
export function cleanupTempOnStartup(tempDir: string): void {
    try {
        const files = fs.readdirSync(tempDir);
        let cleaned = 0;
        files.forEach((file) => {
            const filePath = path.join(tempDir, file);
            try {
                const ext = path.extname(file).toLowerCase();
                if (SENSITIVE_EXTS.has(ext)) {
                    secureDelete(filePath);
                } else {
                    fs.unlinkSync(filePath);
                }
                cleaned++;
            } catch { }
        });
        if (cleaned > 0) {
            console.log(`[SpeedySign] Limpiados ${cleaned} archivo(s) temporales huérfanos al arrancar.`);
        }
    } catch { }
}

/**
 * Controla que el almacenamiento de IPAs no supere el límite máximo (por defecto 25 GB).
 * Si lo supera, hace un barrido de emergencia borrando todo sin importar la edad.
 */
export function enforceStorageLimit(dirs: string[], maxBytes: number): void {
    let totalSize = 0;
    const allFiles: { path: string, stat: fs.Stats }[] = [];

    // Calcular el tamaño total de los directorios
    for (const dir of dirs) {
        try {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.isFile()) {
                        totalSize += stat.size;
                        allFiles.push({ path: filePath, stat });
                    }
                } catch { }
            }
        } catch { }
    }

    if (totalSize > maxBytes) {
        console.warn(`[SpeedySign] ¡ALERTA! El almacenamiento superó el límite de ${Math.round(maxBytes / 1024 / 1024 / 1024)}GB (${Math.round(totalSize / 1024 / 1024)}MB actuales). Forzando limpieza de emergencia...`);
        
        // Borrar todo para liberar espacio (sin importar la edad)
        for (const fileObj of allFiles) {
            try {
                const ext = path.extname(fileObj.path).toLowerCase();
                if (SENSITIVE_EXTS.has(ext)) {
                    secureDelete(fileObj.path);
                } else {
                    fs.unlinkSync(fileObj.path);
                }
            } catch { }
        }
        console.log(`[SpeedySign] Limpieza de emergencia completada. Se eliminaron ${allFiles.length} archivos.`);
    }
}

/**
 * Registra los intervalos de limpieza y los devuelve para poder cancelarlos.
 * Intervalos:
 *  - Temp:     cada 30 minutos (archivos no sensibles de operaciones en curso)
 *  - Signed:   cada 3 minutos (IPAs con TTL de 3 minutos)
 *  - Storage:  cada 1 minuto (Limpieza de emergencia a los 25 GB)
 */
export function startCleanupIntervals(tempDir: string, signedDir: string): { tempInterval: ReturnType<typeof setInterval>; signedInterval: ReturnType<typeof setInterval>; storageInterval: ReturnType<typeof setInterval> } {
    const tempInterval   = setInterval(() => cleanupTempFiles(tempDir),   30 * 60 * 1000);
    const signedInterval = setInterval(() => cleanupSignedFiles(signedDir), 3 * 60 * 1000);
    // 25 GB en bytes: 25 * 1024 * 1024 * 1024 = 26843545600
    const storageInterval = setInterval(() => enforceStorageLimit([tempDir, signedDir], 26843545600), 60 * 1000);
    return { tempInterval, signedInterval, storageInterval };
}
