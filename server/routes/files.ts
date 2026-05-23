/**
 * files.ts
 * Rutas para servir y gestionar archivos firmados.
 *
 * GET    /manifest/:filename   — Genera manifest.plist para OTA (sin auth, iOS lo llama directamente)
 * GET    /download/:filename   — Descarga directa del IPA firmado (sin auth, iOS OTA)
 * DELETE /api/signed/:filename — Elimina un IPA firmado (REQUIERE auth + verificación de ownership)
 *
 * SEGURIDAD OTA:
 *  iOS Safari llama a /manifest y /download sin cabeceras de autenticación.
 *  La protección es que los nombres de archivo contienen:
 *    {userId}_{uuid}_{appName}_signed.ipa
 *  El UUID (122 bits de entropía) hace imposible la enumeración.
 *  La eliminación sí requiere auth y verifica que el filename empiece con el userId.
 */

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { sanitizeFilename } from "../utils/validation";
import { generateManifest } from "../utils/manifest";
import { getBaseUrlFromRequest } from "../utils/network";
import { requireAuth, AuthRequest } from "../middleware/auth";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const SERVER_ROOT = IS_PRODUCTION || __dirname.includes("dist")
    ? path.resolve(__dirname, "..", "..")
    : path.resolve(__dirname, "..");

const SIGNED_DIR = path.resolve(SERVER_ROOT, "signed");

export const filesRouter = Router();

// ── GET /manifest/:filename ───────────────────────────────────────────────────
// Sin autenticación: iOS Safari accede directamente desde el dispositivo.

filesRouter.get("/manifest/:filename", (req: Request, res: Response) => {
    const safeName = sanitizeFilename(req.params.filename as string);
    if (!safeName) {
        return res.status(400).json({ error: "Nombre de archivo inválido" });
    }

    const signedPath = path.join(SIGNED_DIR, safeName);
    if (!path.resolve(signedPath).startsWith(SIGNED_DIR)) {
        return res.status(403).json({ error: "Acceso denegado" });
    }
    if (!fs.existsSync(signedPath)) {
        return res.status(404).json({ error: "Archivo firmado no encontrado" });
    }

    const { bundleId, appName, version } = req.query as Record<string, string>;
    const baseUrl = getBaseUrlFromRequest(req);
    const ipaUrl  = `${baseUrl}/download/${safeName}`;

    const manifest = generateManifest(
        ipaUrl,
        bundleId || "com.speedysign.app",
        appName  || "App",
        version  || "1.0"
    );

    // Apple requiere explícitamente text/xml para manifests OTA
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    // Cache corto: el manifest solo debe vivir mientras el IPA exista
    res.setHeader("Cache-Control", "no-store");
    res.send(manifest);
});

// ── GET /download/:filename ───────────────────────────────────────────────────
// Sin autenticación: iOS Safari descarga el IPA directamente durante la instalación OTA.
// Protección: el nombre contiene un UUID irrepetible → no enumerable.

filesRouter.get("/download/:filename", (req: Request, res: Response) => {
    const safeName = sanitizeFilename(req.params.filename as string);
    if (!safeName) {
        return res.status(400).json({ error: "Nombre de archivo inválido" });
    }

    const filePath = path.join(SIGNED_DIR, safeName);
    if (!path.resolve(filePath).startsWith(SIGNED_DIR)) {
        return res.status(403).json({ error: "Acceso denegado" });
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Archivo no encontrado" });
    }

    res.setHeader("Cache-Control", "no-store");
    res.download(filePath, safeName);
});

// ── DELETE /api/signed/:filename ──────────────────────────────────────────────
// REQUIERE autenticación. Verifica que el archivo pertenezca al usuario autenticado.
// El nombre del archivo tiene el formato: {userId}_{uuid}_{appName}_signed.ipa
// → extraer userId del filename y comparar con req.userId del JWT.

filesRouter.delete("/api/signed/:filename", requireAuth, (req: AuthRequest, res: Response) => {
    const safeName = sanitizeFilename(req.params.filename as string);
    if (!safeName) {
        return res.status(400).json({ error: "Nombre de archivo inválido" });
    }

    // Verificar ownership: el filename debe empezar con el userId del token JWT
    // Formato esperado: {userId}_{uuid}_{appName}_signed.ipa
    // userId de Supabase es un UUID con hyphens: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const userId = req.userId!;
    if (!safeName.startsWith(`${userId}_`)) {
        console.warn(`[SpeedySign] Intento de borrado no autorizado: user=${userId} archivo=${safeName}`);
        return res.status(403).json({ error: "No tienes permiso para eliminar este archivo" });
    }

    const filePath = path.join(SIGNED_DIR, safeName);
    if (!path.resolve(filePath).startsWith(SIGNED_DIR)) {
        return res.status(403).json({ error: "Acceso denegado" });
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Archivo no encontrado" });
    }

    try {
        fs.unlinkSync(filePath);
        console.log(`[SpeedySign] IPA eliminado: ${safeName} por usuario ${userId}`);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: "No se pudo eliminar el archivo" });
    }
});
