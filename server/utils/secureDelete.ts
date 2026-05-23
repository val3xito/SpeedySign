/**
 * secureDelete.ts
 * Eliminación segura de archivos con datos criptográficos sensibles.
 *
 * Antes de llamar a unlink(), sobreescribe el contenido del archivo con
 * ceros para dificultar la recuperación forense en disco.
 * Usar para: .p12, .pem y cualquier archivo que contenga claves privadas.
 * Para archivos no sensibles (IPAs, dylibs), fs.unlinkSync() es suficiente.
 */

import fs from "fs";

/**
 * Sobreescribe el archivo con ceros y luego lo elimina.
 * Si cualquier paso falla, intenta eliminar directamente como fallback.
 *
 * @param filePath - Ruta absoluta del archivo a borrar
 */
export function secureDelete(filePath: string): void {
    try {
        const stat = fs.statSync(filePath);
        const size = stat.size;

        if (size > 0) {
            const fd    = fs.openSync(filePath, "r+");
            const zeros = Buffer.alloc(Math.min(size, 65_536), 0);
            let   offset = 0;

            while (offset < size) {
                const toWrite = Math.min(zeros.length, size - offset);
                fs.writeSync(fd, zeros, 0, toWrite, offset);
                offset += toWrite;
            }

            fs.closeSync(fd);
        }
    } catch {
        /* Si no podemos sobreescribir, al menos intentamos eliminar */
    }

    try {
        fs.unlinkSync(filePath);
    } catch {
        /* Ignorar si ya no existe */
    }
}
