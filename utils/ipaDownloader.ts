/**
 * ipaDownloader.ts
 * Utilidad para descargar archivos IPA usando fetch + Blob.
 * Soporta progreso de descarga mediante streaming, cancelación y limpieza.
 */

import Constants from "expo-constants";
import { Certificate } from "./certValidator";
import { validateProtocol } from "./sanitizer";
import { Platform, Linking } from "react-native";

/** Información de progreso de descarga */
export interface DownloadProgress {
    totalBytesWritten: number;
    totalBytesExpectedToWrite: number;
    /** Porcentaje de 0 a 100 */
    percent: number;
    /** Texto legible (ej: "12.3 MB / 45.6 MB") */
    label: string;
}

/** Resultado de la descarga */
export interface DownloadResult {
    /** Ruta local del archivo descargado */
    uri: string;
    /** Tamaño total en bytes */
    size: number;
}

/** Formatea bytes en texto legible */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Obtiene el token JWT de la sesión actual de Supabase.
 * Lo usamos en el header Authorization: Bearer {token} de cada petición al servidor.
 * Si no hay sesión activa, devuelve un objeto vacío (el servidor rechazará con 401).
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
    try {
        const { supabase } = await import("./supabase");
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
            return { "Authorization": `Bearer ${session.access_token}` };
        }
    } catch {
        // Si Supabase no está disponible, continuar sin token (fallará en el servidor)
    }
    return {};
}

/**
 * Descarga un archivo IPA desde una URL con progreso real mediante streaming web.
 *
 * @param downloadURL - URL directa del archivo IPA
 * @param appName - Nombre de la app (para el nombre del archivo local)
 * @param onProgress - Callback de progreso (opcional)
 * @returns Resultado con la ruta local del archivo (Blob) y su tamaño
 */
export async function downloadIPA(
    downloadURL: string,
    appName: string,
    onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
    if (!downloadURL || downloadURL.trim() === "") {
        throw new Error("No hay URL de descarga disponible para esta app.");
    }

    // Validar protocolo seguro antes de descargar (previene SSRF)
    if (!validateProtocol(downloadURL)) {
        throw new Error("URL de descarga no segura. Solo se permiten HTTPS, blob: y file:.");
    }

    return downloadIPAWeb(downloadURL, appName, onProgress);
}

/**
 * Descarga en web usando fetch + blob (fallback).
 * Usa streaming con ReadableStream para reportar progreso real.
 */
async function downloadIPAWeb(
    downloadURL: string,
    appName: string,
    onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
    webCancelFlag = false;

    const response = await fetch(downloadURL, {
        headers: { "User-Agent": "SpeedySign/1.0" },
    });

    if (!response.ok) {
        throw new Error(`Error de descarga: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    // Si hay reader, usar streaming para progreso
    if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (webCancelFlag) {
                reader.cancel();
                throw new Error("cancelled");
            }

            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            received += value.length;

            const percent = totalBytes > 0 ? Math.round((received / totalBytes) * 100) : 0;
            onProgress?.({
                totalBytesWritten: received,
                totalBytesExpectedToWrite: totalBytes,
                percent,
                label: totalBytes > 0
                    ? `${formatBytes(received)} / ${formatBytes(totalBytes)}`
                    : `${formatBytes(received)}`,
            });
        }

        const blob = new Blob(chunks as unknown as BlobPart[]);
        const url = URL.createObjectURL(blob);

        return { uri: url, size: received };
    }

    // Fallback sin streaming
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    return { uri: url, size: blob.size };
}

/** Flag de cancelación para web */
let webCancelFlag = false;

/**
 * Cancela la descarga actual si hay una en curso.
 */
export async function cancelDownload(): Promise<void> {
    webCancelFlag = true;
}

/**
 * Elimina un archivo web BLOB temporal.
 * @param uri - Ruta del archivo blob
 */
export async function cleanupDownload(uri: string): Promise<void> {
    try {
        URL.revokeObjectURL(uri);
    } catch {
        // Ignorar
    }
}

// ── URL del backend de firma ──────────────────────────────────────────────
// Usa URLs relativas: el frontend y la API se sirven desde el MISMO servidor.
// Funciona tanto en desarrollo local como en producción.

/**
 * Devuelve la URL base del servidor de firma.
 * Al ser relativa (cadena vacía), usa el mismo host que sirve la web.
 *
 * En desarrollo, Expo web corre en un puerto distinto al backend (3001).
 * Si detectamos un puerto que no es el del backend ni el estándar de producción,
 * apuntamos explícitamente a :3001 en el mismo host (funciona en localhost y red local).
 */
export function getSigningServerURL(): string {
    // 1. Variable de entorno explícita (producción con backend separado, ej. Oracle)
    const envUrl = process.env.EXPO_PUBLIC_SIGNING_SERVER_URL;
    if (envUrl) return envUrl.replace(/\/+$/, ""); // quitar barra final

    if (typeof window !== "undefined") {
        const { hostname, port } = window.location;
        // Dev mode: el frontend de Expo corre en un puerto ≠ 3001 (ej. 8081, 19006)
        // En esos casos apuntamos directamente al backend en :3001
        if (port && port !== "80" && port !== "443" && port !== "3001") {
            return `http://${hostname}:3001`;
        }
    }
    // En producción (mismo origen): URL relativa
    return "";
}

/** Resultado de la firma con el backend */
export interface SigningResult {
    /** URL del IPA firmado */
    signedUrl: string;
    /** URL del manifest.plist para OTA install */
    manifestUrl: string;
    /** URL itms-services:// lista para abrir */
    installUrl: string;
    /** Nombre del archivo firmado */
    fileName: string;
    /** Tamaño del IPA firmado en bytes */
    size: number;
}

/** Evento de progreso emitido por el backend vía SSE */
export interface SigningProgressEvent {
    phase: "download" | "sign" | "done" | "error";
    /** Bytes descargados hasta el momento */
    downloaded?: number;
    /** Tamaño total en bytes (0 si el servidor no envía Content-Length) */
    total?: number;
    message?: string;
}

/** Opciones de personalización pre-firma */
export interface IpaSignCustomOptions {
    customBundleId?:           string;
    customName?:               string;
    customVersion?:            string;
    enableFileSharing?:        boolean;
    removeDeviceRestrictions?: boolean;
    liquidGlass?:              boolean;
    sha256Only?:               boolean;
    compressionLevel?:         number;
    /** Objetos File web para inyección de dylibs */
    dylibFiles?:               File[];
}

/**
 * Retraso con jitter para backoff exponencial.
 */
function backoffDelay(attempt: number): Promise<void> {
    const base  = Math.min(1000 * 2 ** attempt, 10000); // 1s, 2s, 4s… máx 10s
    const jitter = Math.random() * 500;
    return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

/**
 * Envía la URL del IPA al backend para firmarlo con zsign.
 * Incluye reintentos automáticos con backoff exponencial ante errores de red.
 * Envía el token JWT de Supabase en Authorization para autenticar al usuario.
 *
 * @param ipaUrl - URL de descarga del IPA original
 * @param appName - Nombre de la app
 * @param bundleId - Bundle ID de la app
 * @param version - Versión de la app
 * @returns Resultado con URLs del IPA firmado y manifest
 */
export async function signIPAWithBackend(
    ipaUrl: string,
    appName: string,
    cert: Certificate,
    bundleId?: string,
    version?: string,
    signer: "auto" | "zsign" | "arksign" | "speedysigner" = "auto",
    customOptions?: IpaSignCustomOptions,
    onProgress?: (event: SigningProgressEvent) => void,
    onJobReady?: (jobId: string) => void,
    signal?: AbortSignal
): Promise<SigningResult> {
    const serverUrl   = getSigningServerURL();
    const isLocalFile = ipaUrl.startsWith("file://") || ipaUrl.startsWith("blob:");
    const MAX_RETRIES = 2;

    // Obtener token JWT de Supabase para autenticar al servidor
    const authHeaders = await getAuthHeaders();

    // Generar jobId único para rastrear el progreso en el servidor
    const jobId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `job_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const isWeb = typeof window !== "undefined";
    let pollingActive = true;

    // Notificar el jobId al llamador antes de empezar (para poder cancelar)
    if (onJobReady) onJobReady(jobId);

    // Polling secuencial cada 1000 ms para obtener el progreso del servidor sin saturar conexiones
    if (isWeb && onProgress) {
        const statusUrl = `${serverUrl}/api/sign/status/${jobId}`;
        const runPoll = async () => {
            while (pollingActive) {
                try {
                    if (signal?.aborted) {
                        pollingActive = false;
                        break;
                    }
                    const res = await fetch(statusUrl, {
                        headers: { "Bypass-Tunnel-Reminder": "true" },
                        signal,
                    });
                    if (!pollingActive) break;
                    if (res.ok) {
                        const textBody = await res.text();
                        let data: SigningProgressEvent;
                        try {
                            data = JSON.parse(textBody);
                        } catch {
                            await new Promise((r) => setTimeout(r, 500));
                            continue;
                        }
                        if (data && data.phase) {
                            onProgress(data);
                            if (data.phase === "done" || data.phase === "error") {
                                pollingActive = false;
                                break;
                            }
                        }
                    }
                } catch {
                    // Servidor aún no ha registrado el job o error temporal de red
                }
                if (!pollingActive) break;
                await new Promise((r) => {
                    const timeout = setTimeout(r, 1000);
                    if (signal) {
                        signal.addEventListener("abort", () => {
                            clearTimeout(timeout);
                            r(null);
                        });
                    }
                });
            }
        };
        runPoll();
    }

    console.log(`[SpeedySign] Firmando en: ${serverUrl}/api/sign`);

    /** Construye el FormData con los archivos y opciones necesarios */
    const buildFormData = async (): Promise<FormData> => {
        const formData = new FormData();
        formData.append("appName", appName);
        if (bundleId) formData.append("bundleId", bundleId);
        formData.append("version", version || "1.0");
        formData.append("signer", signer);
        if (isWeb && onProgress) formData.append("jobId", jobId);

        if (customOptions) {
            const co = customOptions;
            if (co.customBundleId)           formData.append("customBundleId",          co.customBundleId);
            if (co.customName)               formData.append("customName",               co.customName);
            if (co.customVersion)            formData.append("customVersion",            co.customVersion);
            if (co.enableFileSharing)        formData.append("enableFileSharing",        "true");
            if (co.removeDeviceRestrictions) formData.append("removeDeviceRestrictions", "true");
            if (co.liquidGlass)              formData.append("liquidGlass",              "true");
            if (co.sha256Only)               formData.append("sha256Only",               "true");
            if (co.compressionLevel != null) formData.append("compressionLevel",         String(co.compressionLevel));
            for (const dylib of (co.dylibFiles || [])) formData.append("dylibFiles", dylib, dylib.name);
        }

        const addFileToForm = async (key: string, uri: string, name: string, _type: string) => {
            try {
                if (signal?.aborted) throw new DOMException("The user aborted a request.", "AbortError");
                // Ruta de Supabase Storage (formato: user_id/timestamp_filename)
                if (uri && !uri.startsWith("http") && !uri.startsWith("blob:") && !uri.startsWith("file:") && uri.includes("/")) {
                    const { supabase } = await import("./supabase");
                    const { data } = await supabase.storage.from("certificates").createSignedUrl(uri, 300);
                    if (data?.signedUrl) {
                        if (signal?.aborted) throw new DOMException("The user aborted a request.", "AbortError");
                        const res  = await fetch(data.signedUrl, { signal });
                        const blob = await res.blob();
                        formData.append(key, blob, name);
                        console.log(`[SpeedySign] ${name} descargado de Supabase`);
                        return;
                    }
                }
                if (signal?.aborted) throw new DOMException("The user aborted a request.", "AbortError");
                const res  = await fetch(uri, { signal });
                const blob = await res.blob();
                formData.append(key, blob, name);
            } catch (e: any) {
                console.error(`Error fetching ${name}:`, e);
                if (e.name === "AbortError" || e.message?.includes("aborted")) {
                    throw e;
                }
            }
        };

        if (cert.p12URI)       await addFileToForm("p12File",       cert.p12URI,       cert.p12FileName      || "cert.p12",              "application/x-pkcs12");
        if (cert.provisionURI) await addFileToForm("provisionFile", cert.provisionURI, cert.provisionFileName || "prov.mobileprovision", "application/octet-stream");
        if (cert.password)     formData.append("p12Password", cert.password);

        if (isLocalFile) {
            await addFileToForm("ipaFile", ipaUrl, appName.replace(/[^a-zA-Z0-9]/g, "_") + ".ipa", "application/octet-stream");
        } else {
            formData.append("ipaUrl", ipaUrl);
        }
        return formData;
    };

    /** Intenta una petición de firma; devuelve Response o lanza en error no-retryable */
    const attemptSign = async (): Promise<Response> => {
        const formData = await buildFormData();
        return fetch(`${serverUrl}/api/sign`, {
            method:  "POST",
            // Incluir JWT para autenticar al servidor (requerido por requireAuth middleware)
            headers: { "Bypass-Tunnel-Reminder": "true", ...authHeaders },
            body:    formData,
            signal,
        });
    };

    let lastError: Error = new Error("Error desconocido");

    try {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[SpeedySign] Reintento ${attempt}/${MAX_RETRIES}...`);
                    if (signal?.aborted) throw new DOMException("The user aborted a request.", "AbortError");
                    await backoffDelay(attempt - 1);
                }

                if (signal?.aborted) throw new DOMException("The user aborted a request.", "AbortError");

                const response = await attemptSign();
                const textBody = await response.text();
                let data: any = {};
                try {
                    data = JSON.parse(textBody);
                } catch {
                    // Si no es JSON (ej. Cloudflare/Nginx HTML error)
                    if (!response.ok) {
                        data = { error: `HTTP ${response.status}: ${textBody.substring(0, 150)}...` };
                    }
                }

                if (!response.ok) {
                    const msg = data.detail || data.error || "Error al firmar la app en el servidor";
                    if (response.status >= 400 && response.status < 500) throw new Error(msg);
                    lastError = new Error(msg);
                    continue;
                }

                return {
                    signedUrl:   data.signedUrl,
                    manifestUrl: data.manifestUrl,
                    installUrl:  data.installUrl,
                    fileName:    data.fileName,
                    size:        data.size,
                };
            } catch (e: any) {
                if (e.name === "AbortError" || (e.message && e.message.includes("aborted"))) {
                    throw e; // Do not retry, propagate abort immediately
                }
                if (e.message && !e.message.includes("fetch")) throw e;
                lastError = new Error(`No se pudo conectar con ${serverUrl} — ${e.message}`);
            }
        }

        throw lastError;
    } finally {
        // Detener polling siempre, haya éxito, error o reintento
        pollingActive = false;
    }
}

/**
 * Elimina un IPA firmado del servidor tras su instalación/descarga.
 * Requiere autenticación — envía el JWT de Supabase.
 *
 * @param fileName - Nombre del archivo firmado (ej: "{userId}_{uuid}_{appName}_signed.ipa")
 */
export async function deleteSignedIPA(fileName: string): Promise<void> {
    try {
        const serverUrl = getSigningServerURL();
        const authHeaders = await getAuthHeaders();
        await fetch(`${serverUrl}/api/signed/${encodeURIComponent(fileName)}`, {
            method:  "DELETE",
            headers: { "Bypass-Tunnel-Reminder": "true", ...authHeaders },
        });
        console.log(`[SpeedySign] IPA eliminado del servidor: ${fileName}`);
    } catch (e) {
        console.warn("[SpeedySign] No se pudo eliminar el IPA del servidor:", e);
    }
}

/**
 * Verifica si el backend de firma está disponible.
 * El endpoint /api/status es público (no requiere auth).
 * @returns true si el servidor responde correctamente
 */
export async function isSigningServerAvailable(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${getSigningServerURL()}/api/status`, {
            signal: controller.signal,
            headers: { "Bypass-Tunnel-Reminder": "true" },
        });
        clearTimeout(timeout);
        if (!response.ok) return false;
        const text = await response.text();
        let data: any;
        try { data = JSON.parse(text); } catch { return false; }
        return data.status === "ok" && data.ready === true;
    } catch {
        return false;
    }
}

/**
 * Instala o descarga un IPA.
 * En iOS Safari, usa itms-services:// para disparar la instalación OTA.
 * En PC web, dispara la descarga del archivo al disco.
 *
 * @param fileUri - URI del blob descargado
 * @param downloadURL - URL original de descarga
 * @param appName - Nombre de la app
 * @param installUrl - URL itms-services:// del backend (opcional)
 */
export async function installIPA(
    fileUri: string,
    downloadURL: string,
    appName: string,
    installUrl?: string
): Promise<void> {
    // Detectar de forma robusta si estamos en un dispositivo iOS (nativo o web)
    const isIOS = Platform.OS === "ios" || 
        (Platform.OS === "web" && typeof navigator !== "undefined" && (
            /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
        ));

    if (installUrl && isIOS) {
        console.log("[SpeedySign] Detectado iOS, abriendo itms-services...");
        if (Platform.OS === "ios") {
            await Linking.openURL(installUrl);
        } else {
            window.location.href = installUrl;
        }
        return;
    }

    if (Platform.OS === "web" && typeof document !== "undefined") {
        // Descarga directa del archivo al usuario (en PC web o Android web)
        const a = document.createElement("a");
        a.href = fileUri;
        a.download = `${appName.replace(/[^a-zA-Z0-9]/g, "_")}.ipa`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } else {
        // En contenedor nativo no-iOS o como fallback, intentar abrir la URL de descarga directa
        await Linking.openURL(fileUri || downloadURL);
    }
}

/**
 * Cancela un proceso de firma activo en el servidor.
 * Aborta la descarga y el proceso de firma (zsign/arksign) en el servidor.
 * No requiere auth (jobId es el token de un solo uso).
 */
export async function cancelSigningJob(jobId: string): Promise<void> {
    if (!jobId) return;
    try {
        await fetch(`${getSigningServerURL()}/api/sign/cancel/${encodeURIComponent(jobId)}`, {
            method: "DELETE",
            headers: { "Bypass-Tunnel-Reminder": "true" },
        });
    } catch {
        // Silencioso — el proceso puede haber terminado ya
    }
}
