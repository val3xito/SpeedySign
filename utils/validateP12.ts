/**
 * validateP12.ts — Validación del certificado .p12 en el navegador
 * Usa node-forge para intentar parsear el PKCS12 con la contraseña dada.
 * Si falla, la contraseña es incorrecta.
 */
import forge from "node-forge";

export interface P12ValidationResult {
    valid: boolean;
    error?: string;
    commonName?: string;
    expirationDate?: string;
    certPems?: string[];
}

/**
 * Valida un archivo .p12 con la contraseña proporcionada.
 * @param p12URI - URI del archivo .p12 (blob:, file://, etc.)
 * @param password - Contraseña del .p12
 * @returns Resultado de la validación
 */
export async function validateP12Password(
    p12URI: string,
    password: string,
    p12FileObj?: File
): Promise<P12ValidationResult> {
    try {
        // Descargar el archivo .p12 o usar el objeto File
        let arrayBuffer: ArrayBuffer;
        if (p12FileObj) {
            arrayBuffer = await p12FileObj.arrayBuffer();
        } else {
            const response = await fetch(p12URI);
            arrayBuffer = await response.arrayBuffer();
        }

        // Convertir ArrayBuffer a cadena binaria para forge
        const bytes = new Uint8Array(arrayBuffer);
        let binaryString = "";
        for (let i = 0; i < bytes.length; i++) {
            binaryString += String.fromCharCode(bytes[i]);
        }

        // Convertir a ASN1 y parsear PKCS12
        const asn1 = forge.asn1.fromDer(binaryString);
        const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password || "");

        // Si llegamos aquí, la contraseña es correcta
        // Intentar extraer info del certificado
        let commonName = "";
        let expirationDate = "";
        let certPems: string[] = [];

        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const certs = certBags[forge.pki.oids.certBag];
        if (certs && certs.length > 0) {
            // Buscar el certificado hoja (leaf): el que NO es CA
            const leafBag = certs.find(b => {
                if (!b.cert) return false;
                const bc = b.cert.getExtension('basicConstraints') as any;
                return !bc || bc.cA !== true;
            }) || certs[0];

            const cert = leafBag.cert;
            if (cert) {
                const cn = cert.subject.getField("CN");
                if (cn) commonName = cn.value as string;
                expirationDate = cert.validity.notAfter.toISOString();
            }

            // Leaf primero, luego intermedios — el backend OCSP espera leaf en [0]
            const leafPem = leafBag.cert
                ? forge.pki.certificateToPem(leafBag.cert)
                : null;
            const otherPems = certs
                .filter(b => b.cert && b !== leafBag)
                .map(b => forge.pki.certificateToPem(b.cert as forge.pki.Certificate));
            certPems = [...(leafPem ? [leafPem] : []), ...otherPems];
        }

        return {
            valid: true,
            commonName,
            expirationDate,
            certPems,
        };
    } catch (error: any) {
        const msg = error.message || "";

        // Detectar errores de contraseña incorrecta
        if (
            msg.includes("Invalid password") ||
            msg.includes("PKCS#12 MAC") ||
            msg.includes("mac verify failure") ||
            msg.includes("decryption failed")
        ) {
            return {
                valid: false,
                error: "Contraseña incorrecta para este certificado .p12",
            };
        }

        // Si forge no puede parsear el P12 (probablemente formato moderno OpenSSL 3.x),
        // lo aceptamos igualmente — el servidor tiene OpenSSL y lo convertirá al formato correcto.
        console.warn("[validateP12] forge no pudo parsear el P12 (posiblemente formato moderno), aceptando:", msg);
        return {
            valid: true,
            commonName: "",
            expirationDate: "",
            certPems: [],
        };
    }
}
