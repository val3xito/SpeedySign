/**
 * proxy.ts
 * Proxy CORS server-side para carga de repositorios.
 * Permite al navegador obtener JSONs de repos sin restricciones CORS.
 */

import { Router, Request, Response } from "express";
import https from "https";
import http from "http";
import rateLimit from "express-rate-limit";
import { isPrivateHostname, safeLookup } from "../utils/validation";

export const proxyRouter = Router();

/** Rate limiter permisivo para el proxy (carga de catálogo de repos) */
export const proxyLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minuto
    max: 300,              // 300 peticiones/min por IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas peticiones al proxy. Intenta de nuevo en un minuto." },
});

function proxyFetchUrl(url: string, res: Response, redirects: number): void {
    if (redirects > 5) {
        res.status(502).json({ error: "Demasiados redirects" });
        return;
    }

    let parsed: URL;
    try { parsed = new URL(url); } catch {
        res.status(502).json({ error: "URL de redirect inválida" });
        return;
    }

    const proto = parsed.protocol === "https:" ? https : http;
    const chunks: Buffer[] = [];
    let responded = false;

    const request = proto.get(url, {
        headers: { 
            "Accept": "application/json, text/plain, */*", 
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            "Referer": `${parsed.protocol}//${parsed.hostname}/`
        },
        lookup: safeLookup
    }, (response: any) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            proxyFetchUrl(response.headers.location, res, redirects + 1);
            return;
        }
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
            if (responded) return;
            responded = true;
            const body = Buffer.concat(chunks).toString("utf8");
            res.status(response.statusCode || 200).type("application/json").send(body);
        });
        response.on("error", () => {
            if (!responded) { responded = true; res.status(502).json({ error: "Error de stream" }); }
        });
    });

    request.setTimeout(8000, () => {
        (request as any).destroy();
        if (!responded) { responded = true; res.status(504).json({ error: "Timeout" }); }
    });
    (request as any).on("error", (e: NodeJS.ErrnoException) => {
        if (!responded) { responded = true; res.status(502).json({ error: "Error de red: " + e.code }); }
    });
}

function proxyFetchImage(url: string, res: Response, redirects: number): void {
    if (redirects > 5) { res.status(502).end(); return; }

    let parsed: URL;
    try { parsed = new URL(url); } catch { res.status(502).end(); return; }

    const proto = parsed.protocol === "https:" ? https : http;
    const chunks: Buffer[] = [];
    let responded = false;

    const request = proto.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            "Accept": "image/webp,image/avif,image/png,image/jpeg,image/*,*/*;q=0.8",
            "Referer": `${parsed.protocol}//${parsed.hostname}/`,
        },
        lookup: safeLookup
    }, (response: any) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            const loc = response.headers.location.startsWith("http")
                ? response.headers.location
                : `${parsed.protocol}//${parsed.hostname}${response.headers.location}`;
            proxyFetchImage(loc, res, redirects + 1);
            return;
        }
        const contentType = response.headers["content-type"] || "image/png";
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
            if (responded) return;
            responded = true;
            res.status(response.statusCode || 200)
                .setHeader("Content-Type", contentType)
                .setHeader("Cache-Control", "public, max-age=86400")
                .send(Buffer.concat(chunks));
        });
        response.on("error", () => { if (!responded) { responded = true; res.status(502).end(); } });
    });

    request.setTimeout(10000, () => { (request as any).destroy(); if (!responded) { responded = true; res.status(504).end(); } });
    (request as any).on("error", () => { if (!responded) { responded = true; res.status(502).end(); } });
}

/** Proxy de imágenes — preserva content-type para que el navegador las muestre correctamente */
proxyRouter.get("/img", proxyLimiter, (req: Request, res: Response) => {
    const rawUrl = String(req.query.url || "");
    if (!rawUrl) { res.status(400).json({ error: "Parámetro url requerido" }); return; }

    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { res.status(400).json({ error: "URL inválida" }); return; }

    if (!["http:", "https:"].includes(parsed.protocol)) { res.status(400).json({ error: "Solo se permiten URLs http/https" }); return; }

    // Protección SSRF centralizada: cubre 169.254.* (cloud metadata), IPv6-mapped IPv4,
    // rangos privados RFC1918, loopback y link-local
    if (isPrivateHostname(parsed.hostname)) {
        res.status(403).json({ error: "URL no permitida" });
        return;
    }

    proxyFetchImage(rawUrl, res, 0);
});

proxyRouter.get("/", proxyLimiter, (req: Request, res: Response) => {
    const rawUrl = String(req.query.url || "");
    if (!rawUrl) {
        res.status(400).json({ error: "Parámetro url requerido" });
        return;
    }

    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch {
        res.status(400).json({ error: "URL inválida" });
        return;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        res.status(400).json({ error: "Solo se permiten URLs http/https" });
        return;
    }

    // Protección SSRF centralizada: cubre 169.254.* (cloud metadata), IPv6-mapped IPv4,
    // rangos privados RFC1918, loopback y link-local
    if (isPrivateHostname(parsed.hostname)) {
        res.status(403).json({ error: "URL no permitida" });
        return;
    }

    proxyFetchUrl(rawUrl, res, 0);
});
