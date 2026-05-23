/**
 * certValidator.ts
 * Utilidades para validar y gestionar certificados de firma.
 * NOTA: En un entorno real, la validación de .p12 requiere código nativo.
 * Aquí simulamos la validación basándonos en los metadatos guardados.
 */

/** Interfaz que representa un certificado importado */
export interface Certificate {
    id: string;                  // Identificador único
    name: string;                // Nombre del certificado
    type: "development" | "distribution"; // Tipo de certificado
    expirationDate: string;      // Fecha de expiración (ISO string)
    importedAt: string;          // Fecha de importación (ISO string)
    p12FileName: string;         // Nombre del archivo .p12
    provisionFileName: string;   // Nombre del archivo .mobileprovision
    p12URI?: string;             // URI local del archivo .p12
    provisionURI?: string;       // URI local del archivo .mobileprovision
    isValid: boolean;            // Si el certificado es válido
    password?: string;           // Contraseña opcional del .p12
}

/**
 * Verifica si un certificado ha expirado.
 * Compara la fecha de expiración con la fecha actual.
 * @param expirationDate - Fecha de expiración en formato ISO
 * @returns true si el certificado ha expirado
 */
export function isCertificateExpired(expirationDate: string): boolean {
    const expDate = new Date(expirationDate);
    const now = new Date();
    return expDate <= now;
}

/**
 * Calcula los días restantes hasta la expiración del certificado.
 * @param expirationDate - Fecha de expiración en formato ISO
 * @returns Número de días restantes (negativo si ya expiró)
 */
export function daysUntilExpiration(expirationDate: string): number {
    const expDate = new Date(expirationDate);
    const now = new Date();
    const diffMs = expDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Formatea la fecha de expiración para mostrar al usuario.
 * @param expirationDate - Fecha en formato ISO
 * @returns Fecha formateada en español (ej: "15 de marzo de 2025")
 */
export function formatExpirationDate(expirationDate: string): string {
    const date = new Date(expirationDate);
    return date.toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
    });
}

/**
 * Obtiene el estado de validez del certificado como texto.
 * @param expirationDate - Fecha de expiración en formato ISO
 * @returns Objeto con texto de estado y color asociado
 */
export function getCertificateStatus(expirationDate: string): {
    text: string;
    color: "success" | "warning" | "danger";
} {
    const days = daysUntilExpiration(expirationDate);

    if (days <= 0) {
        return { text: "Expirado", color: "danger" };
    } else if (days <= 30) {
        return { text: `Expira en ${days} días`, color: "warning" };
    } else {
        return { text: "Válido", color: "success" };
    }
}

/**
 * Genera un certificado simulado a partir de los nombres de archivo.
 * En una app real, se extraería esta info del contenido del .p12.
 * @param p12FileName - Nombre del archivo .p12
 * @param provisionFileName - Nombre del archivo .mobileprovision
 * @returns Objeto Certificate con datos simulados
 */
export function createMockCertificate(
    p12FileName: string,
    provisionFileName: string,
    password?: string,
    p12URI?: string,
    provisionURI?: string,
    certId?: string
): Certificate {
    // Generar ID único basado en timestamp
    const id = certId || `cert-${Date.now()}`;

    // Extraer nombre limpio del archivo
    const name = p12FileName.replace(".p12", "").replace(/_/g, " ");

    // Simular una fecha de expiración (1 año desde ahora)
    const expDate = new Date();
    expDate.setFullYear(expDate.getFullYear() + 1);

    // Determinar tipo basado en el nombre del archivo
    const isDistribution =
        p12FileName.toLowerCase().includes("dist") ||
        p12FileName.toLowerCase().includes("distribution");

    return {
        id,
        name,
        type: isDistribution ? "distribution" : "development",
        expirationDate: expDate.toISOString(),
        importedAt: new Date().toISOString(),
        p12FileName,
        provisionFileName,
        p12URI,
        provisionURI,
        isValid: true,
        password,
    };
}
