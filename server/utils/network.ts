/**
 * network.ts
 * Utilidades de red para el servidor SpeedySign.
 */

import https from "https";
import http from "http";
import fs from "fs";
import os from "os";
import { pipeline } from "stream/promises";
import { Request } from "express";

const PORT = process.env.PORT || 3001;
export const MAX_DOWNLOAD_SIZE = parseInt(process.env.MAX_DOWNLOAD_SIZE || "524288000", 10); // 500 MB por defecto

const DOWNLOAD_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
};

function getDownloadHeaders(url: string): Record<string, string> {
    try {
        const parsed = new URL(url);
        return { ...DOWNLOAD_HEADERS, "Referer": `${parsed.protocol}//${parsed.hostname}/` };
    } catch {
        return DOWNLOAD_HEADERS;
    }
}

// Cola de descargas con límite de concurrencia y soporte de cancelación (AbortSignal)
class DownloadQueue {
    private active = 0;
    private max = 5;
    private queue: { resolve: () => void; reject: (err: Error) => void; signal?: AbortSignal }[] = [];

    async run<T>(fn: () => Promise<T>, signal?: AbortSignal, onWait?: () => void): Promise<T> {
        if (signal?.aborted) {
            throw new Error("Cancelled");
        }

        if (this.active < this.max) {
            this.active++;
            try {
                return await fn();
            } finally {
                this.active--;
                this.next();
            }
        }

        // Notificar que se está esperando turno en cola
        onWait?.();

        // Registrar promesa en la cola
        await new Promise<void>((resolve, reject) => {
            const queueItem = { resolve, reject, signal };
            
            const onAbort = () => {
                const idx = this.queue.indexOf(queueItem);
                if (idx !== -1) {
                    this.queue.splice(idx, 1);
                }
                reject(new Error("Cancelled"));
            };

            if (signal) {
                signal.addEventListener("abort", onAbort, { once: true });
            }

            queueItem.resolve = () => {
                if (signal) {
                    signal.removeEventListener("abort", onAbort);
                }
                resolve();
            };

            this.queue.push(queueItem);
        });

        this.active++;
        try {
            return await fn();
        } finally {
            this.active--;
            this.next();
        }
    }

    private next() {
        while (this.queue.length > 0 && this.active < this.max) {
            const nextItem = this.queue.shift();
            if (nextItem) {
                // Si la petición ya fue cancelada mientras esperaba en la cola, saltar
                if (nextItem.signal?.aborted) {
                    continue;
                }
                nextItem.resolve();
            }
        }
    }
}

const downloadQueue = new DownloadQueue();

/**
 * Descarga un archivo desde una URL a una ruta local con manejo de redirects (hasta 10 saltos).
 * @param onProgress - Callback opcional con bytes descargados y total (0 si no hay Content-Length)
 */
interface GoogleDriveResolution {
    downloadUrl: string;
    filename: string | null;
    size: number | null;
    headers: Record<string, string>;
}

/**
 * Extrae el ID de archivo de Google Drive desde URLs públicas.
 */
export function getGoogleDriveFileId(urlStr: string): string | null {
    try {
        const url = new URL(urlStr);
        if (!url.hostname.includes("drive.google.com") && !url.hostname.includes("docs.google.com")) {
            return null;
        }
        const fileDRegex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
        const matchD = url.pathname.match(fileDRegex);
        if (matchD && matchD[1]) return matchD[1];

        const idRegex = /[?&]id=([a-zA-Z0-9_-]+)/;
        const matchId = url.search.match(idRegex);
        if (matchId && matchId[1]) return matchId[1];
    } catch {
        // Ignorar
    }
    return null;
}

/**
 * Resuelve y realiza el bypass de advertencia de virus de Google Drive para archivos grandes,
 * acumulando cookies y extrayendo el confirm token.
 */
export function resolveGoogleDriveDownload(fileId: string): Promise<GoogleDriveResolution> {
    return new Promise((resolve, reject) => {
        const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        const headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "Accept": "*/*",
        };

        const makeRequest = (currentUrl: string, redirectsLeft: number, currentCookies: string[] = []) => {
            if (redirectsLeft <= 0) {
                return reject(new Error("Demasiados redirects al resolver Google Drive"));
            }

            const parsed = new URL(currentUrl);
            const reqHeaders: Record<string, string> = { ...headers };
            if (currentCookies.length > 0) {
                reqHeaders["Cookie"] = currentCookies.map(c => c.split(";")[0]).join("; ");
            }

            const req = https.get(currentUrl, { headers: reqHeaders }, (res) => {
                const statusCode = res.statusCode || 200;

                // Seguir redirect
                if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                    let nextUrl = res.headers.location;
                    if (nextUrl.startsWith("/")) {
                        nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
                    }

                    // Acumular cookies
                    const newCookies = res.headers["set-cookie"] || [];
                    const mergedCookies = [...currentCookies, ...newCookies];

                    res.resume();
                    makeRequest(nextUrl, redirectsLeft - 1, mergedCookies);
                    return;
                }

                if (statusCode !== 200) {
                    res.resume();
                    req.destroy();
                    reject(new Error(`HTTP ${statusCode} al resolver Google Drive`));
                    return;
                }

                const contentType = res.headers["content-type"] || "";
                const contentDisposition = res.headers["content-disposition"];
                const contentLength = res.headers["content-length"];

                // Caso 1: Descarga directa ya iniciada (con content-disposition o no HTML)
                if (contentDisposition || !contentType.includes("text/html")) {
                    let filename: string | null = null;
                    if (contentDisposition) {
                        const filenameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^;"']+)["']?/i);
                        if (filenameMatch && filenameMatch[1]) {
                            filename = decodeURIComponent(filenameMatch[1]);
                        } else {
                            const simpleMatch = contentDisposition.match(/filename\s*=\s*([^;\s]+)/i);
                            if (simpleMatch && simpleMatch[1]) {
                                filename = decodeURIComponent(simpleMatch[1].replace(/["']/g, ""));
                            }
                        }
                    }

                    const size = contentLength ? parseInt(contentLength, 10) : null;
                    res.resume();
                    req.destroy();

                    const cookieHeader = currentCookies.map(c => c.split(";")[0]).join("; ");
                    resolve({
                        downloadUrl: currentUrl,
                        filename,
                        size,
                        headers: cookieHeader ? { "Cookie": cookieHeader } : {}
                    });
                    return;
                }

                // Caso 2: Página de advertencia HTML de Google Drive
                if (contentType.includes("text/html")) {
                    let body = "";
                    let destroyed = false;
                    res.on("data", (chunk) => {
                        if (destroyed) return;
                        body += chunk.toString();
                        if (body.length > 150000) {
                            destroyed = true;
                            res.destroy();
                            reject(new Error("Respuesta de Google Drive demasiado grande al buscar confirmación"));
                        }
                    });

                    res.on("end", () => {
                        if (destroyed) return;
                        const confirmMatch = body.match(/confirm=([A-Za-z0-9_-]+)/);
                        const confirmToken = confirmMatch ? confirmMatch[1] : null;
                        const newCookies = res.headers["set-cookie"] || [];
                        const mergedCookies = [...currentCookies, ...newCookies];

                        if (confirmToken) {
                            const confirmedUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmToken}`;
                            makeRequest(confirmedUrl, redirectsLeft - 1, mergedCookies);
                        } else {
                            reject(new Error("No se pudo obtener el token de confirmación de Google Drive"));
                        }
                    });

                    res.on("error", (err) => {
                        reject(err);
                    });
                    return;
                }

                res.resume();
                req.destroy();
                reject(new Error("Formato de respuesta desconocido de Google Drive"));
            });

            req.on("error", (err) => {
                reject(err);
            });
        };

        makeRequest(driveUrl, 10);
    });
}

/**
 * Resuelve el nombre y tamaño reales del archivo desde una URL externa.
 */
export async function resolveUrlInfo(url: string): Promise<{ filename: string | null; size: number | null }> {
    const fileId = getGoogleDriveFileId(url);
    if (fileId) {
        try {
            const driveRes = await resolveGoogleDriveDownload(fileId);
            return {
                filename: driveRes.filename,
                size: driveRes.size
            };
        } catch (err) {
            console.error("Error al resolver URL de Google Drive:", err);
            return { filename: null, size: null };
        }
    }

    return new Promise((resolve) => {
        const MAX_REDIRECTS = 10;

        const makeRequest = (requestUrl: string, redirectsLeft: number) => {
            const parsed = new URL(requestUrl);
            const proto = requestUrl.startsWith("https") ? https : http;

            const req = proto.get(requestUrl, { headers: getDownloadHeaders(requestUrl) }, (response) => {
                // Manejar redirects
                if (response.statusCode! >= 300 && response.statusCode! < 400 && response.headers.location) {
                    if (redirectsLeft <= 0) {
                        resolve({ filename: null, size: null });
                        response.resume();
                        return;
                    }
                    let redirectUrl = response.headers.location;
                    if (redirectUrl.startsWith("/")) {
                        redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
                    }
                    response.resume();
                    makeRequest(redirectUrl, redirectsLeft - 1);
                    return;
                }

                // Obtener content-disposition
                const contentDisposition = response.headers["content-disposition"];
                let filename: string | null = null;

                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^;"']+)["']?/i);
                    if (filenameMatch && filenameMatch[1]) {
                        filename = decodeURIComponent(filenameMatch[1]);
                    } else {
                        const simpleMatch = contentDisposition.match(/filename\s*=\s*([^;\s]+)/i);
                        if (simpleMatch && simpleMatch[1]) {
                            filename = decodeURIComponent(simpleMatch[1].replace(/["']/g, ""));
                        }
                    }
                }

                // Si no hay content-disposition, intentar obtener del pathname de la URL final
                if (!filename) {
                    try {
                        const pathname = parsed.pathname;
                        const lastSegment = pathname.substring(pathname.lastIndexOf('/') + 1);
                        if (lastSegment && lastSegment.toLowerCase().endsWith(".ipa")) {
                            filename = decodeURIComponent(lastSegment);
                        }
                    } catch {
                        // Ignorar
                    }
                }

                const contentLength = response.headers["content-length"];
                const size = contentLength ? parseInt(contentLength, 10) : null;

                // Consumir la respuesta y abortar la conexión para no descargar nada de datos
                response.resume();
                req.destroy();

                resolve({ filename, size });
            });

            req.on("error", () => {
                resolve({ filename: null, size: null });
            });
        };

        try {
            makeRequest(url, MAX_REDIRECTS);
        } catch {
            resolve({ filename: null, size: null });
        }
    });
}

/**
 * Descarga un archivo desde una URL a una ruta local con manejo de redirects y soporte de Google Drive.
 */
export function downloadFile(
    url: string,
    destPath: string,
    onProgress?: (downloaded: number, total: number) => void,
    signal?: AbortSignal,
    onWait?: () => void
): Promise<void> {
    return downloadQueue.run(() => {
        return new Promise<void>((resolve, reject) => {
            // Rechazar inmediatamente si ya fue cancelado antes de empezar
            if (signal?.aborted) {
                return reject(new Error("Cancelled"));
            }

            const formatSize = (bytes: number) => {
                if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
                return `${(bytes / 1048576).toFixed(1)} MB`;
            };

            const startDownload = (downloadUrl: string, customHeaders: Record<string, string> = {}) => {
                const MAX_REDIRECTS = 10;

                const makeRequest = (requestUrl: string, redirectsLeft: number) => {
                    const proto = requestUrl.startsWith("https") ? https : http;
                    const reqHeaders = { ...getDownloadHeaders(requestUrl), ...customHeaders };

                    const req = proto.get(requestUrl, { headers: reqHeaders }, (response) => {
                        if (response.statusCode! >= 300 && response.statusCode! < 400 && response.headers.location) {
                            if (redirectsLeft <= 0) {
                                reject(new Error("Demasiados redirects al descargar el IPA"));
                                return;
                            }
                            let redirectUrl = response.headers.location;
                            if (redirectUrl.startsWith("/")) {
                                const base = new URL(requestUrl);
                                redirectUrl = `${base.protocol}//${base.host}${redirectUrl}`;
                            }
                            response.resume();
                            makeRequest(redirectUrl, redirectsLeft - 1);
                            return;
                        }

                        if (response.statusCode !== 200) {
                            response.resume();
                            reject(new Error(`HTTP ${response.statusCode} al descargar`));
                            return;
                        }

                        const total = parseInt(response.headers["content-length"] || "0", 10);
                        if (total > MAX_DOWNLOAD_SIZE) {
                            response.resume();
                            reject(new Error(`El archivo supera el límite máximo de descarga de ${formatSize(MAX_DOWNLOAD_SIZE)}.`));
                            return;
                        }

                        let downloaded = 0;
                        const fileStream = fs.createWriteStream(destPath);

                        let abortedOrFailed = false;
                        const cleanupAndReject = (err: Error) => {
                            if (abortedOrFailed) return;
                            abortedOrFailed = true;

                            req.destroy();
                            response.destroy();
                            fileStream.destroy();

                            // Eliminar el archivo parcial del disco
                            fs.unlink(destPath, () => {});

                            signal?.removeEventListener("abort", onAbort);
                            reject(err);
                        };

                        // Cancelar descarga en curso al recibir la señal
                        const onAbort = () => {
                            cleanupAndReject(new Error("Cancelled"));
                        };
                        signal?.addEventListener("abort", onAbort, { once: true });

                        response.on("data", (chunk: Buffer) => {
                            downloaded += chunk.length;
                            if (downloaded > MAX_DOWNLOAD_SIZE) {
                                cleanupAndReject(new Error(`El archivo supera el límite máximo de descarga de ${formatSize(MAX_DOWNLOAD_SIZE)}.`));
                                return;
                            }
                            onProgress?.(downloaded, total);
                        });

                        response.on("error", (err) => {
                            cleanupAndReject(err);
                        });

                        fileStream.on("error", (err) => {
                            cleanupAndReject(err);
                        });

                        response.pipe(fileStream);

                        fileStream.on("finish", () => {
                            if (abortedOrFailed) return;
                            signal?.removeEventListener("abort", onAbort);
                            resolve();
                        });
                    }).on("error", reject);

                    // Cancelar antes de recibir respuesta
                    signal?.addEventListener("abort", () => req.destroy(new Error("Cancelled")), { once: true });
                };

                makeRequest(downloadUrl, MAX_REDIRECTS);
            };

            const fileId = getGoogleDriveFileId(url);
            if (fileId) {
                resolveGoogleDriveDownload(fileId)
                    .then((driveRes) => {
                        if (signal?.aborted) {
                            return reject(new Error("Cancelled"));
                        }
                        startDownload(driveRes.downloadUrl, driveRes.headers);
                    })
                    .catch((err) => {
                        reject(err);
                    });
            } else {
                startDownload(url);
            }
        });
    }, signal, onWait);
}

/**
 * Resuelve el nombre real del archivo remoto siguiendo redirects y leyendo los headers,
 * destruyendo la conexión inmediatamente después para evitar consumo de datos.
 */
export async function resolveUrlFilename(url: string): Promise<string | null> {
    const info = await resolveUrlInfo(url);
    return info.filename;
}

/**
 * Obtiene la IP local de la máquina.
 * Prioriza adaptadores reales sobre virtuales (VMware, VirtualBox, WSL).
 */
export function getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    const virtualPatterns = /^(vmware|virtualbox|vethernet|vbox|docker|wsl)/i;
    let fallbackIP: string | null = null;

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === "IPv4" && !iface.internal) {
                if (virtualPatterns.test(name)) {
                    if (!fallbackIP) fallbackIP = iface.address;
                } else {
                    return iface.address;
                }
            }
        }
    }
    return fallbackIP || "localhost";
}

/**
 * Obtiene la base URL del servidor usando el Host header de la request.
 * Detecta HTTPS cuando se usa a través de un proxy (Render, Cloudflare, etc.).
 * En producción (host público) siempre usa HTTPS para que itms-services:// funcione en iOS.
 */
export function getBaseUrlFromRequest(req: Request): string {
    const host = req.headers.host;
    if (host) {
        // x-forwarded-proto puede venir como "https, http" — tomar solo el primero
        const forwarded = req.headers["x-forwarded-proto"];
        const firstProto = Array.isArray(forwarded)
            ? forwarded[0]
            : (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null);

        // Si el proxy indica el protocolo, usarlo; si no, inferir por host
        const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
        const proto = firstProto || (isLocalhost ? "http" : "https");
        return `${proto}://${host}`;
    }
    return `http://${getLocalIP()}:${PORT}`;
}
