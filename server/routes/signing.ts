/**
 * signing.ts
 * Rutas de firma e inspección de IPAs.
 *
 * POST /api/sign         — Descarga, modifica y firma un IPA (REQUIERE auth)
 * POST /api/inspect-ipa  — Inspecciona el Info.plist de un IPA (REQUIERE auth)
 * POST /api/check-ocsp   — Verifica estado OCSP de un certificado (REQUIERE auth)
 * GET  /api/status       — Health check público (sin datos sensibles)
 * GET  /api/sign/progress/:jobId — SSE de progreso (sin auth, jobId es UUID secreto)
 * GET  /api/sign/status/:jobId   — Polling de progreso (sin auth, jobId es UUID secreto)
 * DELETE /api/sign/cancel/:jobId — Cancelar firma (sin auth, jobId es UUID secreto)
 *
 * FILENAMES DE IPAs FIRMADOS:
 *   Formato: {userId}_{uuid}_{appName}_signed.ipa
 *   - userId:  UUID del usuario (verificación de propiedad en DELETE)
 *   - uuid:    UUID aleatorio (122 bits de entropía → no enumerable)
 *   - appName: nombre saneado de la app
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { executeSign } from "../services/signingService";
import { inspectIPA, modifyIPA } from "../services/ipaService";
import { checkCertificateOCSP } from "../services/ocspService";
import { downloadFile, getBaseUrlFromRequest, resolveUrlFilename, resolveUrlInfo } from "../utils/network";
import { isValidAppName, isValidDownloadUrl, isValidBundleId, isValidIPAFile, isValidVersion, isSafeZip, isValidDylibFile } from "../utils/validation";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { secureDelete } from "../utils/secureDelete";
import { signQueue } from "../utils/queue";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const SERVER_ROOT = IS_PRODUCTION || __dirname.includes("dist")
    ? path.resolve(__dirname, "..", "..")
    : path.resolve(__dirname, "..");

const SIGNED_DIR = path.resolve(SERVER_ROOT, "signed");
const TEMP_DIR   = path.resolve(SERVER_ROOT, "temp");
const BIN_DIR    = path.resolve(SERVER_ROOT, "bin");

const ZSIGN_PATH   = process.platform === "win32"
    ? path.join(BIN_DIR, "zsign.exe")
    : path.join(BIN_DIR, "zsign");
const ARKSIGN_PATH = process.platform === "win32"
    ? path.join(BIN_DIR, "arksign.exe")
    : path.join(BIN_DIR, "arksign");

// Leer credenciales opcionales del proyecto principal (modo local)
let P12_PATH      = "";
let P12_PASSWORD  = "";
let PROVISION_PATH = "";

try {
    const credentialsPath = path.join(SERVER_ROOT, "..", "credentials.json");
    const CREDENTIALS = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    P12_PATH       = CREDENTIALS.ios.distributionCertificate.path;
    P12_PASSWORD   = CREDENTIALS.ios.distributionCertificate.password;
    PROVISION_PATH = CREDENTIALS.ios.provisioningProfilePath;
} catch { /* modo cloud — certificados se reciben por petición */ }

// ── Multer ────────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
    destination: TEMP_DIR,
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || "";
        const allowedExts = [".ipa", ".p12", ".mobileprovision", ".dylib"];
        if (!allowedExts.includes(ext.toLowerCase())) {
            return cb(new Error("Tipo de archivo no permitido"), "");
        }
        // Nombre interno totalmente aleatorio — sin datos del usuario en disco
        cb(null, `${Date.now()}_${randomUUID()}${ext}`);
    },
});

const MAX_IPA_SIZE_MB = parseInt(process.env.MAX_IPA_SIZE_MB || "500", 10);
const MAX_IPA_BYTES = MAX_IPA_SIZE_MB * 1024 * 1024;

const upload = multer({
    storage,
    limits: { fileSize: MAX_IPA_BYTES, files: 15 },
});

// ── Rate limiters ─────────────────────────────────────────────────────────────
// signLimiter: por usuario autenticado (req.userId) o por IP como fallback.
// Se aplica DESPUÉS de requireAuth para que req.userId esté disponible.

export const signLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,  // 1 hora
    max: 30,                   // 30 firmas por hora (muy generoso, solo para evitar spam masivo)
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).userId || req.ip || "unknown",
    message: { error: "Has superado el límite de 30 firmas por hora. Intenta de nuevo más tarde." },
});

// Mapa en memoria para el cooldown de subidas personalizadas de IPAs (3 minutos)
const customUploadCooldowns = new Map<string, number>();

// Set para rastrear a los usuarios que tienen una instalación (firma) en proceso
const activeUserSignings = new Set<string>();

// Tracking de límites y strikes en memoria
const dailySignatures = new Map<string, { count: number, date: string }>();
const userStrikes = new Map<string, { count: number, bannedUntil: number }>();
const MAX_DAILY_SIGNS = 50;
const MAX_STRIKES = 5;
const BAN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 horas

export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas peticiones. Intenta de nuevo en unos minutos." },
});

export const signingRouter = Router();

// ── SSE Progress store ────────────────────────────────────────────────────────

interface SigningProgress {
    phase: "download" | "sign" | "done" | "error";
    downloaded?: number;
    total?: number;
    message?: string;
}

const progressStore   = new Map<string, SigningProgress>();
const progressClients = new Map<string, Set<any>>();
/** AbortController por jobId — permite cancelar descarga y firma en servidor */
const jobControllers  = new Map<string, AbortController>();

function emitProgress(jobId: string, event: SigningProgress): void {
    progressStore.set(jobId, event);
    const clients = progressClients.get(jobId);
    if (!clients) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
        try { client.write(data); } catch { /* cliente desconectado */ }
    }
}

function cleanupJob(jobId: string): void {
    setTimeout(() => {
        progressStore.delete(jobId);
        progressClients.delete(jobId);
        jobControllers.delete(jobId);
    }, 5000);
}

// ── GET /sign/progress/:jobId  (SSE) ─────────────────────────────────────────
// Sin auth: el jobId es un UUID aleatorio generado por el cliente (122 bits de
// entropía), equivalente a un token de sesión de un solo uso. No hay información
// sensible en el stream, solo porcentajes y fases.

signingRouter.get("/sign/progress/:jobId", (req: Request, res: Response) => {
    const jobId = req.params.jobId as string;
    if (!jobId || !/^[a-zA-Z0-9_-]{8,128}$/.test(jobId)) {
        return res.status(400).json({ error: "jobId inválido" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const existing = progressStore.get(jobId);
    if (existing) {
        res.write(`data: ${JSON.stringify(existing)}\n\n`);
        if (existing.phase === "done" || existing.phase === "error") {
            res.end();
            return;
        }
    }

    if (!progressClients.has(jobId)) progressClients.set(jobId, new Set());
    progressClients.get(jobId)!.add(res);

    const heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 15000);

    req.on("close", () => {
        clearInterval(heartbeat);
        progressClients.get(jobId)?.delete(res);
        if (progressClients.get(jobId)?.size === 0) progressClients.delete(jobId);
    });
});

// ── DELETE /sign/cancel/:jobId ────────────────────────────────────────────────

signingRouter.delete("/sign/cancel/:jobId", (req: Request, res: Response) => {
    const jobId = req.params.jobId as string;
    const controller = jobControllers.get(jobId);
    if (controller) {
        controller.abort();
        console.log(`  🛑 Firma cancelada por el cliente: ${jobId}`);
        emitProgress(jobId, { phase: "error", message: "Cancelado por el usuario" });
        cleanupJob(jobId);
        return res.json({ cancelled: true });
    }
    res.status(404).json({ error: "Job no encontrado o ya terminado" });
});

// ── GET /sign/status/:jobId  (polling) ───────────────────────────────────────

signingRouter.get("/sign/status/:jobId", (req: Request, res: Response) => {
    const jobId = req.params.jobId as string;
    const progress = progressStore.get(jobId);
    if (!progress) return res.status(404).json({ phase: null });
    res.json(progress);
});

// ── GET /status ───────────────────────────────────────────────────────────────
// Health check público. Solo informa si el servidor está listo.
// No expone rutas de binarios, configuración interna ni conteo de archivos.

signingRouter.get("/status", (_req: Request, res: Response) => {
    const signerReady = fs.existsSync(ZSIGN_PATH) || fs.existsSync(ARKSIGN_PATH);
    res.json({ status: "ok", ready: signerReady });
});

// ── POST /sign ────────────────────────────────────────────────────────────────
// REQUIERE autenticación (requireAuth).
// signLimiter se aplica después del auth para usar req.userId como clave.

signingRouter.post("/sign", requireAuth, signLimiter, upload.fields([
    { name: "ipaFile",       maxCount: 1  },
    { name: "p12File",       maxCount: 1  },
    { name: "provisionFile", maxCount: 1  },
    { name: "dylibFiles",    maxCount: 10 },
]), async (req: AuthRequest, res: Response) => {
    const {
        ipaUrl, bundleId, appName, version, p12Password, signer,
        jobId,
        customName, customVersion, customBundleId,
        sha256Only, compressionLevel,
        enableFileSharing, removeDeviceRestrictions, liquidGlass,
    } = req.body;

    const files         = (req as any).files || {};
    const ipaFile       = files["ipaFile"]?.[0]       ?? null;
    const p12File       = files["p12File"]?.[0]       ?? null;
    const provisionFile = files["provisionFile"]?.[0] ?? null;
    const dylibFiles    = (files["dylibFiles"] ?? []) as any[];

    // Lista de archivos sensibles a limpiar en cualquier salida
    const sensitiveFiles: (string | undefined)[] = [p12File?.path, provisionFile?.path];
    const cleanupAll = (includeOutput = false) => {
        [tempIpaPath, modifiedIpaPath, ...savedDylibPaths].forEach(f => {
            if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch { }
        });
        sensitiveFiles.forEach(f => {
            if (f && fs.existsSync(f)) secureDelete(f);
        });
        if (includeOutput && signedIpaPath && fs.existsSync(signedIpaPath)) {
            try { fs.unlinkSync(signedIpaPath); } catch { }
        }
    };

    // Cooldown de 3 minutos para cualquier firma de IPA (por subida directa o descarga remota)
    const lastUpload = customUploadCooldowns.get(req.userId!) || 0;
    const now = Date.now();
    if (now - lastUpload < 3 * 60 * 1000) {
        // Eliminar archivos que multer acaba de guardar antes de rechazar
        [ipaFile, p12File, provisionFile, ...dylibFiles].forEach((uf: any) => {
            if (uf?.path && fs.existsSync(uf.path)) try { fs.unlinkSync(uf.path); } catch { }
        });
        return res.status(429).json({ error: "Solo puedes realizar una firma de aplicación cada 3 minutos. Por favor, espera." });
    }
    customUploadCooldowns.set(req.userId!, now);

    if (!ipaUrl && !ipaFile) {
        return res.status(400).json({ error: "Se requiere ipaUrl o un ipaFile" });
    }
    if (!isValidAppName(appName)) {
        return res.status(400).json({ error: "Nombre de app inválido (solo alfanuméricos, máx 100 chars)" });
    }
    if (ipaUrl && !isValidDownloadUrl(ipaUrl)) {
        return res.status(400).json({ error: "URL de descarga inválida o no permitida" });
    }
    if (bundleId && !isValidBundleId(bundleId)) {
        return res.status(400).json({ error: "Bundle ID inválido" });
    }
    if (customBundleId && !isValidBundleId(customBundleId)) {
        return res.status(400).json({ error: "customBundleId inválido" });
    }
    // Validar campos opcionales de nombre y versión para evitar que lleguen strings
    // arbitrarios a zsign/arksign. execFile es seguro contra inyección de shell,
    // pero strings muy largos o con caracteres raros pueden crashear la herramienta.
    if (customName && !isValidAppName(customName)) {
        return res.status(400).json({ error: "customName inválido (solo alfanuméricos, máx 100 chars)" });
    }
    if (customVersion && !isValidVersion(customVersion)) {
        return res.status(400).json({ error: "customVersion inválido (solo alfanuméricos, puntos y guiones, máx 30 chars)" });
    }
    if (compressionLevel != null) {
        const compLevel = parseInt(compressionLevel, 10);
        if (isNaN(compLevel) || compLevel < 0 || compLevel > 6) {
            return res.status(400).json({ error: "compressionLevel inválido (debe estar entre 0 y 6)" });
        }
    }

    // Límites de tamaño por tipo de archivo: multer solo tiene un límite global de 500 MB.
    // Los certificados y dylibs no deberían pesar cientos de MB; un tamaño inusual
    // es señal de un archivo incorrecto o de un intento de saturar el disco.
    const FILE_SIZE_LIMITS: Record<string, number> = {
        p12File:       5   * 1024 * 1024,   //   5 MB — certificados .p12
        provisionFile: 5   * 1024 * 1024,   //   5 MB — provisioning profiles
        dylibFiles:    50  * 1024 * 1024,   //  50 MB — dylibs por archivo
        ipaFile:       MAX_IPA_BYTES,       // Límite configurable para IPAs
    };
    for (const [fieldName, maxSize] of Object.entries(FILE_SIZE_LIMITS)) {
        const fieldFiles: any[] = Array.isArray(files[fieldName]) ? files[fieldName] : (files[fieldName] ? [files[fieldName]] : []);
        for (const f of fieldFiles) {
            if (f.size > maxSize) {
                // En este punto tempIpaPath/modifiedIpaPath/savedDylibPaths aún no están
                // declarados (const TDZ), así que limpiamos directamente los archivos
                // que multer ya escribió en disco antes de rechazar la petición.
                [ipaFile, ...dylibFiles].forEach((uf: any) => {
                    if (uf?.path && fs.existsSync(uf.path)) try { fs.unlinkSync(uf.path); } catch { }
                });
                sensitiveFiles.forEach(sf => {
                    if (sf && fs.existsSync(sf)) secureDelete(sf);
                });
                return res.status(413).json({
                    error: `El archivo ${fieldName} excede el límite permitido (${Math.round(maxSize / 1024 / 1024)} MB)`,
                });
            }
        }
    }

    const p12PathToUse       = p12File ? p12File.path : P12_PATH;
    const provisionPathToUse = provisionFile ? provisionFile.path : PROVISION_PATH;
    const p12PasswordToUse   = p12File ? (p12Password || "") : P12_PASSWORD;

    if (!fs.existsSync(ZSIGN_PATH) && !fs.existsSync(ARKSIGN_PATH)) {
        return res.status(503).json({ error: "Servicio de firma no disponible" });
    }
    if (!fs.existsSync(p12PathToUse)) {
        return res.status(503).json({ error: "Certificado .p12 no encontrado" });
    }
    if (!fs.existsSync(provisionPathToUse)) {
        return res.status(503).json({ error: "Provisioning profile no encontrado" });
    }

    // Nombre del archivo firmado: {userId}_{uuid}_{appName}_signed.ipa
    // - userId: permite verificar propiedad en DELETE
    // - uuid: hace el nombre imposible de enumerar (122 bits de entropía)
    const userId       = req.userId!;

    const strikeData = userStrikes.get(userId);
    if (strikeData && strikeData.bannedUntil > Date.now()) {
        const remainingHours = Math.ceil((strikeData.bannedUntil - Date.now()) / (1000 * 60 * 60));
        [ipaFile, ...dylibFiles].forEach((uf: any) => {
            if (uf?.path && fs.existsSync(uf.path)) try { fs.unlinkSync(uf.path); } catch { }
        });
        sensitiveFiles.forEach(f => { if (f && fs.existsSync(f)) secureDelete(f); });
        return res.status(403).json({ error: `Cuenta bloqueada por infracciones. Intenta de nuevo en ${remainingHours} horas.` });
    }

    const todayStr = new Date().toISOString().split("T")[0];
    let userDaily = dailySignatures.get(userId);
    if (!userDaily || userDaily.date !== todayStr) {
        userDaily = { count: 0, date: todayStr };
    }
    if (userDaily.count >= MAX_DAILY_SIGNS) {
        [ipaFile, ...dylibFiles].forEach((uf: any) => {
            if (uf?.path && fs.existsSync(uf.path)) try { fs.unlinkSync(uf.path); } catch { }
        });
        sensitiveFiles.forEach(f => { if (f && fs.existsSync(f)) secureDelete(f); });
        return res.status(429).json({ error: `Has alcanzado el límite diario de ${MAX_DAILY_SIGNS} instalaciones. Vuelve mañana.` });
    }

    const addStrike = () => {
        const data = userStrikes.get(userId) || { count: 0, bannedUntil: 0 };
        data.count++;
        if (data.count >= MAX_STRIKES) {
            data.bannedUntil = Date.now() + BAN_DURATION_MS;
            data.count = 0;
        }
        userStrikes.set(userId, data);
    };

    // Evitar múltiples instalaciones simultáneas del mismo usuario
    if (activeUserSignings.has(userId)) {
        [ipaFile, ...dylibFiles].forEach((uf: any) => {
            if (uf?.path && fs.existsSync(uf.path)) try { fs.unlinkSync(uf.path); } catch { }
        });
        sensitiveFiles.forEach(f => {
            if (f && fs.existsSync(f)) secureDelete(f);
        });
        return res.status(429).json({ error: "Ya tienes una instalación en proceso. Por favor, espera a que termine antes de iniciar otra." });
    }
    activeUserSignings.add(userId);

    const fileToken    = randomUUID();
    const safeName     = appName.replace(/[^a-zA-Z0-9]/g, "_");
    const signedFileName = `${userId}_${fileToken}_${safeName}_signed.ipa`;

    const tempIpaPath    = ipaFile ? ipaFile.path : path.join(TEMP_DIR, `${fileToken}_unsigned.ipa`);
    const signedIpaPath  = path.join(SIGNED_DIR, signedFileName);
    const modifiedIpaPath = path.join(TEMP_DIR, `${fileToken}_modified.ipa`);
    const savedDylibPaths: string[] = dylibFiles.map((f: any) => f.path);
    const hasPlistMods = enableFileSharing === "true" || removeDeviceRestrictions === "true" || liquidGlass === "true"
        || !!customBundleId || !!customName || !!customVersion;

    console.log(`\n📦 Nueva solicitud de firma: ${appName} (user: ${userId.slice(0, 8)}...)`);

    const abortController = new AbortController();
    if (jobId) jobControllers.set(jobId, abortController);
    const { signal } = abortController;

    let responseSent = false;
    const onConnClose = () => {
        if (!responseSent) {
            console.log(`  🔌 Conexión cerrada por el cliente (jobId: ${jobId || 'desconocido'}). Abortando firma...`);
            abortController.abort();
        }
    };
    req.on("close", onConnClose);

    try {
        if (!ipaFile) {
            console.log(`  ⬇️  Descargando IPA...`);
            await downloadFile(
                ipaUrl,
                tempIpaPath,
                jobId ? (downloaded, total) => emitProgress(jobId, { phase: "download", downloaded, total }) : undefined,
                signal,
                jobId ? () => emitProgress(jobId, { phase: "download", message: "Esperando en cola de descarga..." }) : undefined
            );
        }

        // Verificar que el IPA es un ZIP válido (magic bytes PK\x03\x04)
        if (!isValidIPAFile(tempIpaPath)) {
            if (!ipaFile && fs.existsSync(tempIpaPath)) fs.unlinkSync(tempIpaPath);
            cleanupAll();
            addStrike();
            if (!res.headersSent) {
                return res.status(400).json({ error: "El archivo no es un IPA válido" });
            }
            return;
        }

        // Protección contra Zip Bombs
        if (!isSafeZip(tempIpaPath)) {
            cleanupAll();
            addStrike();
            if (!res.headersSent) {
                return res.status(400).json({ error: "El archivo IPA supera el límite de seguridad de descompresión (posible Zip Bomb)." });
            }
            return;
        }

        // Validación de archivos .dylib (Mach-O)
        for (const dylib of savedDylibPaths) {
            if (!isValidDylibFile(dylib)) {
                cleanupAll();
                addStrike();
                if (!res.headersSent) {
                    return res.status(400).json({ error: "Uno de los archivos .dylib es inválido o no tiene formato Mach-O." });
                }
                return;
            }
        }

        const stats = fs.statSync(tempIpaPath);
        console.log(`  ✅ Archivo listo: ${(stats.size / (1024 * 1024)).toFixed(1)} MB`);

        const waitingCount = signQueue.getWaitingCount();
        if (waitingCount > 0) {
            console.log(`  ⏳ Solicitud en cola (Posición: ${waitingCount})...`);
            if (jobId) emitProgress(jobId, { phase: "sign", message: `Esperando en cola (Posición: ${waitingCount})...` });
        }

        await signQueue.enqueue(async () => {
            if (signal.aborted) {
                throw new Error("Cancelled");
            }
            if (jobId) emitProgress(jobId, { phase: "sign", message: "Firmando aplicación..." });

            let ipaToSign = tempIpaPath;
            if (hasPlistMods) {
                console.log(`  ✏️  Aplicando modificaciones al IPA...`);
                await modifyIPA(tempIpaPath, modifiedIpaPath, {
                    bundleId:                 customBundleId || undefined,
                    displayName:              customName     || undefined,
                    shortVersion:             customVersion  || undefined,
                    enableFileSharing:        enableFileSharing === "true",
                    removeDeviceRestrictions: removeDeviceRestrictions === "true",
                    liquidGlass:              liquidGlass === "true",
                });
                ipaToSign = modifiedIpaPath;
            }

            await executeSign({
                inputPath:        ipaToSign,
                outputPath:       signedIpaPath,
                bundleId,
                p12Path:          p12PathToUse,
                p12Pass:          p12PasswordToUse,
                provisionPath:    provisionPathToUse,
                appName,
                signerPref:       signer || "auto",
                customName:       customName    || undefined,
                customVersion:    customVersion || undefined,
                sha256Only:       sha256Only    === "true",
                compressionLevel: compressionLevel != null ? parseInt(compressionLevel, 10) : undefined,
                dylibPaths:       savedDylibPaths,
                userId,
            }, signal, req.ip || "unknown");
        }, signal);

        if (!fs.existsSync(signedIpaPath)) throw new Error("El archivo firmado no se generó");

        const signedStats = fs.statSync(signedIpaPath);
        const baseUrl     = getBaseUrlFromRequest(req);
        const signedUrl   = `${baseUrl}/download/${signedFileName}`;
        const manifestUrl = `${baseUrl}/manifest/${signedFileName}?bundleId=${encodeURIComponent(bundleId || "com.speedysign.app")}&appName=${encodeURIComponent(customName || appName)}&version=${encodeURIComponent(customVersion || version || "1.0")}`;
        const installUrl  = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;

        console.log(`  ✅ ¡Proceso completado! ${signedFileName}`);

        // Incrementar el uso diario al tener éxito
        userDaily.count++;
        dailySignatures.set(userId, userDaily);

        if (jobId) { emitProgress(jobId, { phase: "done" }); cleanupJob(jobId); }

        // Limpiar archivos temporales (IPA, dylibs)
        [tempIpaPath, modifiedIpaPath, ...savedDylibPaths].forEach(f => {
            if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch { }
        });
        // Limpiar archivos sensibles con eliminación segura (sobreescribir antes de borrar)
        sensitiveFiles.forEach(f => {
            if (f && fs.existsSync(f)) secureDelete(f);
        });

        if (!res.headersSent) {
            res.json({
                success:    true,
                signedUrl,
                manifestUrl,
                installUrl,
                fileName:   signedFileName,
                size:       signedStats.size,
            });
        }

    } catch (error: any) {
        // En producción: mensaje genérico sin detalles internos
        const errorMessage = IS_PRODUCTION
            ? "Error al firmar la app. Verifica el certificado y el perfil de aprovisionamiento."
            : (error.message || "Error al firmar la app");

        console.error(`  ❌ Error al firmar: ${error.message}`);
        if (jobId) { emitProgress(jobId, { phase: "error", message: errorMessage }); cleanupJob(jobId); }

        cleanupAll(true);

        if (!res.headersSent) {
            res.status(500).json({ error: errorMessage });
        }
    } finally {
        responseSent = true;
        req.off("close", onConnClose);
        activeUserSignings.delete(userId);
    }
});

// ── POST /check-ocsp ──────────────────────────────────────────────────────────
// REQUIERE autenticación para evitar uso como proxy de red.

signingRouter.post("/check-ocsp", requireAuth, checkCertificateOCSP as any);

// ── POST /inspect-ipa ─────────────────────────────────────────────────────────
// REQUIERE autenticación.
// Valida la URL con isValidDownloadUrl (incluye protección SSRF).

signingRouter.post("/inspect-ipa", requireAuth, upload.fields([{ name: "ipaFile", maxCount: 1 }]), async (req: AuthRequest, res: Response) => {
    const { ipaUrl } = req.body;
    const files   = (req as any).files || {};
    const ipaFile = files["ipaFile"]?.[0] ?? null;

    if (!ipaUrl && !ipaFile) {
        return res.status(400).json({ error: "Se requiere ipaUrl o ipaFile" });
    }

    // Validar URL antes de descargar (previene SSRF)
    if (ipaUrl && !isValidDownloadUrl(ipaUrl)) {
        return res.status(400).json({ error: "URL de descarga inválida o no permitida" });
    }

    const tempIpaPath = ipaFile
        ? ipaFile.path
        : path.join(TEMP_DIR, `inspect_${randomUUID()}.ipa`);

    try {
        if (!ipaFile) await downloadFile(ipaUrl, tempIpaPath);
        const info = await inspectIPA(tempIpaPath);
        res.json({ success: true, info });
    } catch (err: any) {
        // En producción: no exponer detalles del error
        const detail = IS_PRODUCTION ? undefined : err.message;
        res.status(500).json({ error: "No se pudo inspeccionar el IPA", ...(detail ? { detail } : {}) });
    } finally {
        if (!ipaFile && fs.existsSync(tempIpaPath)) try { fs.unlinkSync(tempIpaPath); } catch { }
        if (ipaFile && fs.existsSync(ipaFile.path)) try { fs.unlinkSync(ipaFile.path); } catch { }
    }
});

// ── POST /resolve-url ──────────────────────────────────────────────────────────
// REQUIERE autenticación.
// Resuelve el nombre real del archivo desde una URL (ej. Google Drive) leyendo los headers.

signingRouter.post("/resolve-url", requireAuth, async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Se requiere url" });
    }
    if (!isValidDownloadUrl(url)) {
        return res.status(400).json({ error: "URL no permitida" });
    }

    try {
        const { filename, size } = await resolveUrlInfo(url);
        if (filename) {
            const cleanName = filename.replace(/\.ipa$/i, "");
            return res.json({ success: true, filename, name: cleanName, size });
        }
        res.json({ success: false, error: "No se pudo resolver el nombre del archivo" });
    } catch (err: any) {
        res.status(500).json({ error: err.message || "Error al resolver URL" });
    }
});
