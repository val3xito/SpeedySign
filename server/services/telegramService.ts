/**
 * telegramService.ts
 * Servicio de descarga nativo de Telegram MTProto usando GramJS.
 * Permite descargar archivos .ipa desde cualquier canal o post de Telegram sin limite de tamaño (hasta 2 GB).
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import path from "path";
import fs from "fs";

const API_ID = Number(process.env.TELEGRAM_API_ID || "0");
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

let clientInstance: TelegramClient | null = null;
let connectingPromise: Promise<TelegramClient> | null = null;

export async function getTelegramMTProtoClient(): Promise<TelegramClient> {
    if (!API_ID || !API_HASH || !BOT_TOKEN) {
        throw new Error(
            "Telegram MTProto no está configurado en el servidor. Configura TELEGRAM_API_ID, TELEGRAM_API_HASH y TELEGRAM_BOT_TOKEN en el archivo .env del servidor."
        );
    }

    if (clientInstance && clientInstance.connected) {
        return clientInstance;
    }

    if (connectingPromise) {
        return connectingPromise;
    }

    connectingPromise = (async () => {
        const stringSession = new StringSession("");
        const client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 5,
        });

        await client.start({
            botAuthToken: BOT_TOKEN,
        });

        clientInstance = client;
        connectingPromise = null;
        console.log("  ✈️  [Telegram MTProto] Cliente conectado y autenticado correctamente.");
        return client;
    })();

    return connectingPromise;
}

export interface TelegramParsedUrl {
    channel: string;
    messageId: number;
}

/**
 * Parsea un enlace de Telegram para extraer el canal y el ID del mensaje.
 */
export function parseTelegramPostUrl(urlStr: string): TelegramParsedUrl | null {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();
        if (!host.includes("t.me") && !host.includes("telegram.me") && !host.includes("telegram.org")) {
            return null;
        }

        const segments = url.pathname.split("/").filter(Boolean);
        if (segments.length === 0) return null;

        // Caso: t.me/s/channelName/123
        if (segments[0] === "s" && segments.length >= 3) {
            const msgId = parseInt(segments[2], 10);
            if (!isNaN(msgId)) return { channel: segments[1], messageId: msgId };
        }

        // Caso: t.me/channelName/123
        if (segments.length >= 2) {
            const msgIdStr = segments[segments.length - 1];
            const msgId = parseInt(msgIdStr, 10);
            if (!isNaN(msgId)) {
                const channel = segments[segments.length - 2];
                return { channel, messageId: msgId };
            }
        }
    } catch {
        // Ignorar
    }
    return null;
}

/**
 * Obtiene la información (nombre de archivo y tamaño) de un mensaje de Telegram.
 */
export async function getTelegramFileInfo(urlStr: string): Promise<{ filename: string | null; size: number | null }> {
    const parsed = parseTelegramPostUrl(urlStr);
    if (!parsed) {
        throw new Error("URL de Telegram no válida. Formato esperado: https://t.me/canal/123");
    }

    const client = await getTelegramMTProtoClient();
    const messages = await client.getMessages(parsed.channel, { ids: [parsed.messageId] });
    if (!messages || messages.length === 0 || !messages[0]) {
        throw new Error(`No se encontró el mensaje #${parsed.messageId} en el canal de Telegram @${parsed.channel}`);
    }

    const msg = messages[0];
    const media = msg.media as any;
    if (!media || !media.document) {
        throw new Error("El mensaje especificado de Telegram no contiene ningún archivo o documento adjunto.");
    }

    const doc = media.document;
    let filename: string | null = null;
    if (doc.attributes) {
        for (const attr of doc.attributes as any[]) {
            if (attr.fileName) {
                filename = attr.fileName;
                break;
            }
        }
    }

    const size = doc.size ? Number(doc.size) : null;
    return { filename, size };
}

/**
 * Descarga el archivo adjunto de un mensaje de Telegram a una ruta local.
 */
export async function downloadTelegramFileViaMTProto(
    urlStr: string,
    destPath: string,
    onProgress?: (downloaded: number, total: number) => void,
    signal?: AbortSignal
): Promise<void> {
    const parsed = parseTelegramPostUrl(urlStr);
    if (!parsed) {
        throw new Error("URL de Telegram no válida. Formato esperado: https://t.me/canal/123");
    }

    if (signal?.aborted) {
        throw new Error("Cancelled");
    }

    const client = await getTelegramMTProtoClient();
    const messages = await client.getMessages(parsed.channel, { ids: [parsed.messageId] });
    if (!messages || messages.length === 0 || !messages[0]) {
        throw new Error(`No se encontró el mensaje #${parsed.messageId} en el canal de Telegram @${parsed.channel}`);
    }

    const msg = messages[0];
    const media = msg.media as any;
    if (!media || !media.document) {
        throw new Error("El mensaje especificado de Telegram no contiene ningún archivo o documento adjunto.");
    }

    const doc = media.document;
    const totalBytes = Number(doc.size || 0);

    let lastTime = Date.now();
    const buffer = await client.downloadMedia(msg.media, {
        progressCallback: (downloadedBytes: any) => {
            if (signal?.aborted) {
                throw new Error("Cancelled");
            }
            const now = Date.now();
            if (now - lastTime > 300 || Number(downloadedBytes) === totalBytes) {
                lastTime = now;
                if (onProgress) {
                    onProgress(Number(downloadedBytes), totalBytes);
                }
            }
        },
    });

    if (signal?.aborted) {
        throw new Error("Cancelled");
    }

    if (!buffer) {
        throw new Error("No se pudo descargar el archivo desde Telegram.");
    }

    if (typeof buffer === "string") {
        if (buffer !== destPath) {
            fs.copyFileSync(buffer, destPath);
        }
    } else if (Buffer.isBuffer(buffer)) {
        fs.writeFileSync(destPath, buffer);
    } else {
        fs.writeFileSync(destPath, buffer as any);
    }
}
