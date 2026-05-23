import * as forge from 'node-forge';
import { isPrivateHostname } from '../utils/validation';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
const ocsp = require('ocsp');

const execFileAsync = promisify(execFile);

/**
 * Extrae los certificados PEM de un buffer .p12.
 * Intenta primero con node-forge (formato antiguo) y si falla
 * usa el CLI de OpenSSL (necesario para el formato moderno OpenSSL 3.x).
 * Devuelve los PEMs ordenados: [leaf, ...intermedios]
 */
async function extractCertsFromP12(p12Buffer: Buffer, password: string): Promise<string[]> {
    // Intento 1: node-forge (rápido, sin procesos externos)
    try {
        const binaryString = p12Buffer.toString('binary');
        const asn1 = forge.asn1.fromDer(binaryString);
        const p12Obj = forge.pkcs12.pkcs12FromAsn1(asn1, password || '');
        const certBags = p12Obj.getBags({ bagType: forge.pki.oids.certBag });
        const certs = certBags[forge.pki.oids.certBag] || [];
        if (certs.length > 0) {
            const leafBag = certs.find(b => {
                if (!b.cert) return false;
                const bc = (b.cert as any).getExtension('basicConstraints') as any;
                return !bc || bc.cA !== true;
            }) || certs[0];
            const leafPem = leafBag.cert ? forge.pki.certificateToPem(leafBag.cert) : null;
            const otherPems = certs
                .filter(b => b.cert && b !== leafBag)
                .map(b => forge.pki.certificateToPem(b.cert as forge.pki.Certificate));
            return [...(leafPem ? [leafPem] : []), ...otherPems];
        }
    } catch { /* pasar al fallback */ }

    // Intento 2: OpenSSL CLI (maneja el formato moderno OpenSSL 3.x)
    const tempPath = path.join(os.tmpdir(), `ocsp_p12_${Date.now()}_${Math.random().toString(36).slice(2)}.p12`);
    try {
        fs.writeFileSync(tempPath, p12Buffer);

        let pemOutput = '';
        // Primero sin -legacy (formato nuevo), luego con -legacy (formato antiguo)
        for (const extraArgs of [[], ['-legacy']]) {
            try {
                const { stdout } = await execFileAsync('openssl', [
                    'pkcs12', '-in', tempPath, '-nokeys',
                    '-passin', `pass:${password}`,
                    ...extraArgs,
                ], { timeout: 10_000 });
                if (stdout.includes('-----BEGIN CERTIFICATE-----')) {
                    pemOutput = stdout;
                    break;
                }
            } catch { /* probar siguiente */ }
        }

        if (!pemOutput) throw new Error('OpenSSL no pudo extraer certificados del .p12');

        // Extraer bloques PEM del output
        const pems: string[] = [];
        const pemRegex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
        let match;
        while ((match = pemRegex.exec(pemOutput)) !== null) {
            pems.push(match[0]);
        }

        // Ordenar: leaf (no CA) primero
        pems.sort((a) => {
            try {
                const cert = forge.pki.certificateFromPem(a);
                const bc = (cert as any).getExtension('basicConstraints') as any;
                return (!bc || bc.cA !== true) ? -1 : 1;
            } catch { return 0; }
        });

        return pems;
    } finally {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { }
    }
}

const DOWNLOAD_TIMEOUT_MS = 10_000; // 10 segundos máximo para descargar el certificado emisor

/**
 * Descarga un archivo desde una URL HTTP/HTTPS y devuelve el Buffer.
 * Incluye timeout para evitar que un servidor AIA lento bloquee el hilo.
 */
function downloadUrl(url: string): Promise<Buffer> {
    const client = url.startsWith('https') ? require('https') : require('http');
    return new Promise((resolve, reject) => {
        const req = client.get(url, (response: any) => {
            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error(`HTTP ${response.statusCode} al descargar ${url}`));
            }
            const chunks: Buffer[] = [];
            response.on('data', (c: Buffer) => chunks.push(c));
            response.on('end',  () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });

        req.on('error', reject);

        // Timeout: destruir la conexión si tarda demasiado
        req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error(`Timeout al descargar el emisor desde ${url}`));
        });
    });
}

/**
 * Extrae las URLs del campo AuthorityInfoAccess de un certificado forge.
 * Devuelve { ocspUrl, issuerUrl }.
 */
function extractAIA(cert: forge.pki.Certificate): { ocspUrl: string; issuerUrl: string } {
    let ocspUrl   = '';
    let issuerUrl = '';

    try {
        const aiaExt: any = (cert.extensions as any[]).find(
            (e: any) => e.id === '1.3.6.1.5.5.7.1.1'
        );
        if (!aiaExt?.value) return { ocspUrl, issuerUrl };

        const asn1Obj: any = forge.asn1.fromDer(aiaExt.value as string);
        for (const accessDescription of asn1Obj.value) {
            const oid = forge.asn1.derToOid(accessDescription.value[0].value);
            const uri: string = accessDescription.value[1].value;

            if (oid === '1.3.6.1.5.5.7.48.1') ocspUrl   = uri;  // id-ad-ocsp
            else if (oid === '1.3.6.1.5.5.7.48.2') issuerUrl = uri; // id-ad-caIssuers
        }
    } catch (_) { /* silencioso */ }

    return { ocspUrl, issuerUrl };
}

/**
 * Descarga el certificado emisor desde la URL dada, lo valida con forge
 * y lo devuelve como PEM string para que la librería ocsp lo parsee correctamente.
 */
async function downloadIssuerAsPem(url: string): Promise<string> {
    const derBuf = await downloadUrl(url);

    try {
        const asn1Obj   = forge.asn1.fromDer(derBuf.toString('binary'));
        const issuerCert = forge.pki.certificateFromAsn1(asn1Obj);
        return forge.pki.certificateToPem(issuerCert);
    } catch (_) {
        throw new Error('El archivo descargado del emisor no es un certificado DER válido.');
    }
}

/**
 * Servicio para verificar el estado de revocación (OCSP) de certificados de Apple.
 *
 * SEGURIDAD — Fail-closed:
 *  Si no se puede obtener el certificado emisor (AIA no disponible, timeout,
 *  error de red), se devuelve status "verification_failed" en lugar de "unknown".
 *  Así un certificado revocado nunca puede pasar la verificación por error de red.
 */
export async function checkCertificateOCSP(req: any, res: any) {
    try {
        const { certPems, p12Base64, p12Password } = req.body;

        let leafPem: string;
        let issuerPem: string | null = null;

        if (p12Base64) {
            // El cliente envió el .p12 en base64 (forge no pudo leerlo en el cliente)
            if (typeof p12Base64 !== 'string' || p12Base64.length > 200_000) {
                return res.status(400).json({ error: "p12Base64 inválido o demasiado grande" });
            }
            let p12Buffer: Buffer;
            try {
                p12Buffer = Buffer.from(p12Base64, 'base64');
            } catch {
                return res.status(400).json({ error: "p12Base64 no es base64 válido" });
            }
            let extractedPems: string[];
            try {
                extractedPems = await extractCertsFromP12(p12Buffer, p12Password || '');
            } catch (e: any) {
                console.error("  ❌ Error extrayendo certs del P12:", e.message);
                return res.status(503).json({
                    status: "verification_failed",
                    message: "No se pudieron extraer los certificados del archivo .p12. Asegúrate de que OpenSSL esté instalado en el servidor.",
                });
            }
            if (extractedPems.length === 0) {
                return res.status(400).json({ error: "No se encontraron certificados en el .p12" });
            }
            leafPem   = extractedPems[0];
            issuerPem = extractedPems.length > 1 ? extractedPems[1] : null;

        } else if (certPems && Array.isArray(certPems) && certPems.length > 0) {
            // Flujo original: el cliente extrajo los PEMs con forge
            leafPem   = certPems[0];
            issuerPem = certPems.length > 1 ? certPems[1] : null;

        } else {
            return res.status(400).json({ error: "Se requiere certPems o p12Base64" });
        }

        // Si no hay issuer en el array, intentarlo vía AIA del cert leaf
        if (!issuerPem) {
            console.log("⚠️ No se proporcionó certificado emisor para OCSP. Intentando AIA...");
            try {
                const leafCert         = forge.pki.certificateFromPem(leafPem);
                const { issuerUrl }    = extractAIA(leafCert);

                if (issuerUrl) {
                    // Validar la URL de AIA contra SSRF antes de hacer la petición.
                    // Un certificado manipulado podría apuntar a 169.254.169.254 (cloud metadata)
                    // u otros servicios internos para extraer información del servidor.
                    let issuerUrlParsed: URL;
                    try { issuerUrlParsed = new URL(issuerUrl); } catch {
                        console.warn("  ⚠️ URL de emisor AIA inválida, omitiendo.");
                        issuerUrlParsed = null as any;
                    }
                    if (issuerUrlParsed && isPrivateHostname(issuerUrlParsed.hostname)) {
                        console.warn(`  ⚠️ URL de emisor AIA bloqueada por filtro SSRF: ${issuerUrl}`);
                        // issuerPem queda null → fail-closed en la comprobación siguiente
                    } else if (issuerUrlParsed) {
                        console.log(`  ⬇️ Descargando emisor desde: ${issuerUrl}`);
                        issuerPem = await downloadIssuerAsPem(issuerUrl);
                        console.log("  ✅ Emisor descargado y validado.");
                    }
                } else {
                    console.log("  ⚠️ No se encontró URL de emisor en AIA.");
                }
            } catch (e: any) {
                console.error("  ❌ Error al obtener emisor por AIA:", e.message);
            }
        }

        // FAIL-CLOSED: si no pudimos obtener el emisor, rechazar en lugar de devolver "unknown"
        if (!issuerPem) {
            return res.status(503).json({
                status:  "verification_failed",
                message: "No se pudo obtener el certificado emisor de Apple. El servidor de Apple puede estar temporalmente inaccesible — inténtalo de nuevo en unos minutos.",
            });
        }

        ocsp.check({ cert: leafPem, issuer: issuerPem }, (err: any, ocspRes: any) => {
            if (err) {
                console.error("  ❌ Error de verificación OCSP:", err.message);
                // Fail-closed también en errores de la verificación
                return res.status(503).json({
                    status:  "verification_failed",
                    message: `No se pudo contactar el servidor OCSP de Apple. Verifica tu conexión e inténtalo de nuevo.`,
                });
            }

            console.log(`  🔍 Estado OCSP: ${ocspRes.type}`);

            if (ocspRes.type === 'good') {
                return res.json({ status: "valid",   message: "Certificado válido y no revocado." });
            } else if (ocspRes.type === 'revoked') {
                return res.json({ status: "revoked", message: "Este certificado ha sido revocado por Apple." });
            } else {
                // Estado 'unknown' de la CA — fail-closed: si no podemos confirmar
                // que el certificado es válido, rechazarlo por seguridad.
                // Un atacante podría forzar respuestas 'unknown' con un responder OCSP manipulado.
                return res.status(503).json({
                    status:  "verification_failed",
                    message: "No se pudo confirmar el estado de revocación del certificado. Por seguridad, no se puede continuar.",
                });
            }
        });

    } catch (error: any) {
        console.error("  ❌ Exception en check-ocsp:", error.message);
        return res.status(500).json({ error: "Error interno al verificar OCSP." });
    }
}
