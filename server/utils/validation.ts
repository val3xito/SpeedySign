/**
 * validation.ts
 * Funciones de validación de inputs para el servidor SpeedySign.
 * Previene inyección, path traversal, URLs peligrosas y SSRF.
 */
import AdmZip from "adm-zip";


/**
 * Valida que un nombre de archivo no contenga caracteres peligrosos.
 * Solo permite alfanuméricos, guiones, puntos y underscores.
 * Rechaza separadores de ruta para prevenir path traversal sin depender de path.basename.
 */
export function sanitizeFilename(filename: string): string | null {
    if (!filename || typeof filename !== "string") return null;
    // Rechazar separadores de ruta y secuencias de escape
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
    return filename;
}

/**
 * Lista de rangos de IPs privadas/reservadas que no deben ser contactadas.
 * Protege contra SSRF directo mediante IPs literales en la URL.
 *
 * Incluye 169.254.0.0/16 (link-local): cubre AWS Instance Metadata (169.254.169.254),
 * GCP Metadata (169.254.169.254) y Azure IMDS (169.254.169.254).
 *
 * Nota: no previene DNS rebinding (dominio público que resuelve a IP privada).
 * Para eso se necesitaría resolución DNS asíncrona — mejora futura.
 */
const PRIVATE_IP_PATTERNS: RegExp[] = [
    /^localhost$/i,
    /^127\./,                                         // loopback IPv4
    /^0\./,                                           // red 0.0.0.0/8
    /^10\./,                                          // RFC1918 clase A
    /^172\.(1[6-9]|2\d|3[01])\./,                    // RFC1918 clase B
    /^192\.168\./,                                    // RFC1918 clase C
    /^169\.254\./,                                    // link-local / AWS+GCP+Azure metadata
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,      // CGNAT RFC6598
    /^::1$/,                                          // loopback IPv6
    /^::ffff:/i,                                      // IPv6-mapped IPv4 (bypass clásico)
    /^fc[0-9a-f]{2}:/i,                               // IPv6 ULA fc00::/7
    /^fd[0-9a-f]{2}:/i,                               // IPv6 ULA fd00::/8
    /^fe80:/i,                                        // IPv6 link-local
    /^\[.*\]$/,                                       // cualquier IPv6 literal entre corchetes
];

/**
 * Comprueba si un hostname apunta a una IP privada/reservada.
 * Usar en cualquier punto donde el servidor hace peticiones HTTP a URLs externas
 * (proxy, descargas de certificados, OCSP) para prevenir SSRF.
 *
 * @returns true si el hostname es privado/peligroso (debe bloquearse)
 */
export function isPrivateHostname(hostname: string): boolean {
    if (!hostname || typeof hostname !== "string") return true; // fail-closed
    const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    if (normalized.startsWith("::ffff:")) {
        return isPrivateHostname(normalized.slice("::ffff:".length));
    }
    return PRIVATE_IP_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Valida que una URL sea segura para descargar contenido externo.
 * - Solo HTTPS en producción (HTTP también en desarrollo).
 * - Bloquea IPs privadas, loopback y link-local para prevenir SSRF.
 * - Rechaza IPv6 literales (vector frecuente de bypass de filtros).
 *
 * Devuelve true si la URL es segura, false en caso contrario.
 */
export function isValidDownloadUrl(url: string): boolean {
    if (!url || typeof url !== "string") return false;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }

    const isProd = process.env.NODE_ENV === "production";

    // Solo HTTPS en producción; HTTP también permitido en desarrollo
    if (isProd && parsed.protocol !== "https:") return false;
    if (!isProd && parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

    const hostname = parsed.hostname;

    // Verificar contra rangos privados
    if (isPrivateHostname(hostname)) return false;

    return true;
}

/**
 * Valida un bundle ID de iOS (formato reverse-DNS).
 */
export function isValidBundleId(bundleId: string): boolean {
    if (!bundleId) return true; // Opcional
    return /^[a-zA-Z][a-zA-Z0-9.-]*$/.test(bundleId) && bundleId.length <= 155;
}

/**
 * Valida un nombre de app (alfanuméricos, espacios, guiones).
 */
export function isValidAppName(appName: string): boolean {
    if (!appName || typeof appName !== "string") return false;
    return /^[a-zA-Z0-9\s._\-()]+$/.test(appName) && appName.length <= 100;
}

/**
 * Valida una cadena de versión (p. ej. "1.0", "2.3.1", "1.0.0-beta").
 * Máximo 30 caracteres para evitar que zsign/arksign reciba strings excesivamente largos.
 */
export function isValidVersion(version: string): boolean {
    if (!version || typeof version !== "string") return false;
    return /^[a-zA-Z0-9._\-]{1,30}$/.test(version);
}

/**
 * Verifica los magic bytes de un archivo IPA (que es un ZIP).
 * Los primeros 4 bytes de un ZIP válido son: 50 4B 03 04 ("PK\x03\x04").
 * Devuelve true si el archivo parece un ZIP/IPA legítimo.
 */
export function isValidIPAFile(filePath: string): boolean {
    try {
        const fs = require("fs") as typeof import("fs");
        const buffer = Buffer.alloc(4);
        const fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);
        // ZIP magic: PK\x03\x04
        return buffer[0] === 0x50 && buffer[1] === 0x4B &&
               buffer[2] === 0x03 && buffer[3] === 0x04;
    } catch {
        return false;
    }
}

/**
 * Previene Zip Bombs limitando el tamaño máximo descomprimido a 1.5 GB.
 */
export function isSafeZip(filePath: string, maxBytes = 1.5 * 1024 * 1024 * 1024): boolean {
    try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        let totalUncompressedSize = 0;
        for (const entry of entries) {
            totalUncompressedSize += entry.header.size;
            if (totalUncompressedSize > maxBytes) return false;
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Verifica los magic bytes de un archivo Mach-O (como un .dylib).
 * Firmas comunes de Mach-O:
 * 32-bit: CE FA ED FE (little endian) o FE ED FA CE (big endian)
 * 64-bit: CF FA ED FE (little endian) o FE ED FA CF (big endian)
 * Universal/Fat: CA FE BA BE o BE BA FE CA
 */
export function isValidDylibFile(filePath: string): boolean {
    try {
        const fs = require("fs") as typeof import("fs");
        const buffer = Buffer.alloc(4);
        const fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);
        
        const hex = buffer.toString('hex').toLowerCase();
        const validSignatures = [
            "cefaedfe", "feedface", // 32-bit
            "cffaedfe", "feedfacf", // 64-bit
            "cafebabe", "bebafeca"  // fat binary
        ];
        return validSignatures.includes(hex);
    } catch {
        return false;
    }
}

/**
 * Función de resolución DNS segura para interceptar y prevenir DNS Rebinding / SSRF.
 * Se puede pasar como la opción 'lookup' a http.get / https.get.
 */
export function safeLookup(
    hostname: string,
    options: any,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
): void {
    const dns = require("dns") as typeof import("dns");
    dns.lookup(hostname, options, (err, address, family) => {
        if (err) {
            return callback(err, address, family);
        }
        if (isPrivateHostname(address)) {
            return callback(new Error("SSRF: Acceso a IP privada/reservada bloqueado"), "", family);
        }
        callback(null, address, family);
    });
}
