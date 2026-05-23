/**
 * SpeedySign Signing Server
 * ─────────────────────────
 * Backend que firma IPAs con zsign / arksign.
 *
 * Arquitectura de módulos:
 *  - routes/proxy.ts    → Proxy CORS para repos
 *  - routes/signing.ts  → POST /api/sign, /api/inspect-ipa, GET /api/status
 *  - routes/files.ts    → GET /manifest, /download, DELETE /api/signed
 *  - utils/validation.ts → Validación de inputs + SSRF protection
 *  - utils/network.ts    → downloadFile, getLocalIP, getBaseUrlFromRequest
 *  - utils/manifest.ts   → generateManifest
 *  - utils/cleanup.ts    → Limpieza de archivos temporales
 *  - utils/secureDelete.ts → Eliminación segura de claves privadas
 *  - middleware/auth.ts  → Verificación JWT de Supabase
 *  - services/signingService.ts → Orquestador zsign/arksign
 *  - services/ipaService.ts     → Inspección y modificación de IPAs
 *  - services/ocspService.ts    → Verificación OCSP
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import fs from "fs";
import path from "path";
import multer from "multer";

import { proxyRouter } from "./routes/proxy";
import { signingRouter, apiLimiter } from "./routes/signing";
import { filesRouter } from "./routes/files";
import { getLocalIP } from "./utils/network";
import { cleanupSignedOnStartup, cleanupTempOnStartup, startCleanupIntervals } from "./utils/cleanup";

// ── Configuración ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3001", 10);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const SERVER_ROOT = IS_PRODUCTION || __dirname.includes("dist")
    ? path.resolve(__dirname, "..")
    : __dirname;

const SIGNED_DIR = path.resolve(SERVER_ROOT, "signed");
const TEMP_DIR   = path.resolve(SERVER_ROOT, "temp");
const BIN_DIR    = path.resolve(SERVER_ROOT, "bin");

const DIST_DIR_LOCAL  = path.resolve(SERVER_ROOT, "..", "dist");
const DIST_DIR_DOCKER = path.resolve(SERVER_ROOT, "dist");
const DIST_DIR        = fs.existsSync(DIST_DIR_DOCKER) ? DIST_DIR_DOCKER : DIST_DIR_LOCAL;

// ── Inicialización ─────────────────────────────────────────────────────────────

[SIGNED_DIR, TEMP_DIR, BIN_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log(`📂 SERVER_ROOT: ${SERVER_ROOT}`);
console.log(`📂 BIN_DIR: ${BIN_DIR}`);

cleanupSignedOnStartup(SIGNED_DIR);
cleanupTempOnStartup(TEMP_DIR);   // Elimina huérfanos de crashes anteriores (incluye .p12/.pem)
startCleanupIntervals(TEMP_DIR, SIGNED_DIR);

// ── Express App ────────────────────────────────────────────────────────────────

const app = express();

// Compresión de respuestas HTTP para optimizar rendimiento (Lighthouse)
app.use(compression());

// Confiar en el proxy de Render para obtener la IP real del cliente.
// Sin esto, todos los usuarios comparten la IP del load balancer y el rate limiter los bloquea juntos.
app.set("trust proxy", 1);

// ── Helmet (cabeceras de seguridad) ───────────────────────────────────────────
// CSP activada con directivas apropiadas para Expo Web + Supabase.
// crossOriginEmbedderPolicy desactivado para no romper Supabase Storage (signed URLs).

app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), vr=(), accelerometer=(), gyroscope=()");
    next();
});

app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc:    ["'self'"],
            // Expo Web en producción suele funcionar sin unsafe-inline ni unsafe-eval en scripts
            scriptSrc:     ["'self'"],
            styleSrc:      ["'self'", "'unsafe-inline'"],
            imgSrc:        ["'self'", "data:", "blob:", "https:"],
            // Conexiones permitidas: mismo origen + Supabase + blob para archivos locales
            connectSrc:    ["'self'", "https://*.supabase.co", "wss://*.supabase.co", "https:", "blob:"],
            fontSrc:       ["'self'", "data:"],
            objectSrc:     ["'none'"],
            // Previene clickjacking (equivale a X-Frame-Options: DENY)
            frameAncestors: ["'none'"],
            baseUri:       ["'self'"],
            formAction:    ["'self'"],
        },
    },
    // COEP credentialless permite recursos externos (Supabase) sin CORS estricto en navegadores modernos
    crossOriginEmbedderPolicy: { policy: "credentialless" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // HSTS: 1 año, incluye subdominios
    hsts: IS_PRODUCTION ? {
        maxAge:            31_536_000,
        includeSubDomains: true,
        preload:           true,
    } : false,
}));

// ── CORS ───────────────────────────────────────────────────────────────────────
// En producción: solo orígenes en ALLOWED_ORIGINS (env var, CSV).
// Si ALLOWED_ORIGINS está vacío, se usa RENDER_EXTERNAL_URL como fallback automático
// (Render inyecta esta variable con la URL pública del servicio).
// En desarrollo: todos los orígenes aceptados para facilitar el trabajo local.
// Las peticiones sin Origin (mismo origen, Postman, CLI) siempre se permiten.
//
// SEGURIDAD: fail-closed en producción — si no hay lista configurada ni variable
// de Render, se rechaza cualquier petición cross-origin para prevenir CSRF.

const normalizeOrigin = (o: string) => o.trim().replace(/\/+$/, "");

const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || "";
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

// Fallback automático en Render: RENDER_EXTERNAL_URL = "https://speedysign.onrender.com"
const RENDER_ORIGIN = process.env.RENDER_EXTERNAL_URL
    ? normalizeOrigin(process.env.RENDER_EXTERNAL_URL)
    : null;

// Lista efectiva: ALLOWED_ORIGINS explícito, o la URL de Render, o vacía
const EFFECTIVE_ORIGINS: string[] = ALLOWED_ORIGINS.length > 0
    ? ALLOWED_ORIGINS
    : (RENDER_ORIGIN ? [RENDER_ORIGIN] : []);

if (IS_PRODUCTION && EFFECTIVE_ORIGINS.length === 0) {
    console.warn("[SpeedySign] ⚠️  CORS: ALLOWED_ORIGINS no configurado y RENDER_EXTERNAL_URL no disponible.");
    console.warn("[SpeedySign] ⚠️  Las peticiones cross-origin serán rechazadas. Configura ALLOWED_ORIGINS en tu entorno de producción.");
} else if (IS_PRODUCTION) {
    console.log(`[SpeedySign] 🔒 CORS permitido para: ${EFFECTIVE_ORIGINS.join(", ")}`);
}

app.use(cors({
    origin: (origin, callback) => {
        // Sin Origin → petición sin cabecera Origin (CLI, curl, Postman, mismo origen) → permitir
        if (!origin) return callback(null, true);
        // En desarrollo → permitir todo
        if (!IS_PRODUCTION) return callback(null, true);
        // En producción sin lista → denegar peticiones cross-origin (fail-closed)
        if (EFFECTIVE_ORIGINS.length === 0) {
            return callback(new Error("CORS: origen no autorizado (configura ALLOWED_ORIGINS en producción)"));
        }
        // En producción con lista → comparar normalizando ambos lados
        const normalizedOrigin = normalizeOrigin(origin);
        if (EFFECTIVE_ORIGINS.some(allowed => allowed.toLowerCase() === normalizedOrigin.toLowerCase())) {
            return callback(null, true);
        }
        callback(new Error(`CORS: origen no autorizado: ${origin}`));
    },
    methods:        ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Bypass-Tunnel-Reminder"],
    credentials:    true,
}));

app.use(express.json({ limit: "1mb" }));

// ── Estáticos ──────────────────────────────────────────────────────────────────
// NOTA DE SEGURIDAD: El directorio /signed NO se sirve como estático.
// Los IPAs firmados se sirven únicamente a través de GET /download/:filename
// para que el routing pase por sanitizeFilename(). El acceso público es seguro
// porque los nombres contienen un UUID irrepetible (no enumerable).

if (fs.existsSync(DIST_DIR)) {
    // Servir estáticos con políticas de caché optimizadas para PWA/Expo
    app.use(express.static(DIST_DIR, {
        maxAge: "1h",
        setHeaders: (res, filePath) => {
            if (filePath.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|eot|ttf|otf)$/)) {
                // Recursos inmutables cacheables por 1 año
                res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            } else if (filePath.endsWith("index.html") || filePath.endsWith("manifest.json")) {
                // Evitar caché en el HTML y el manifiesto para actualización inmediata de la PWA
                res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
            }
        }
    }));
}

// ── Rutas ──────────────────────────────────────────────────────────────────────

// Endpoint estándar security.txt (RFC 9116)
app.get("/.well-known/security.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(
        `Contact: mailto:security@speedysign.val3xito.com\n` +
        `Expires: 2027-05-23T12:00:00.000Z\n` +
        `Preferred-Languages: es, en\n` +
        `Canonical: https://speedysign.val3xito.com/.well-known/security.txt\n`
    );
});

app.use("/proxy", proxyRouter);
app.use("/api",   apiLimiter, signingRouter);
app.use("/",      filesRouter);

// ── Error handler global ───────────────────────────────────────────────────────

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Archivo demasiado grande (máx 500 MB)" });
    }
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: "Error al subir archivo" });
    }
    if (err?.message === "Tipo de archivo no permitido") {
        return res.status(400).json({ error: err.message });
    }
    // CORS error
    if (err?.message?.startsWith("CORS:")) {
        return res.status(403).json({ error: "Origen no autorizado" });
    }
    // Nunca exponer detalles del error interno al cliente en producción
    console.error("Error no manejado:", err?.message);
    res.status(500).json({ error: "Error interno del servidor" });
});

// ── Web App Manifest (PWA) ────────────────────────────────────────────────────
// Necesario para que iOS 16.4+ mantenga el scope "/" en modo standalone.
// Se sirve antes del fallback SPA para que express.static no lo intercepte.

const PWA_MANIFEST = JSON.stringify({
    name: "SpeedySign",
    short_name: "SpeedySign",
    description: "Herramienta PWA para firmar e instalar aplicaciones.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0D0D0D",
    theme_color: "#0D0D0D",
    lang: "es",
    icons: [
        { src: "/assets/logo-transparent.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/assets/logo-transparent.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
});

app.get("/manifest.json", (_req, res) => {
    res.setHeader("Content-Type", "application/manifest+json");
    res.send(PWA_MANIFEST);
});

// ── Fallback SPA ───────────────────────────────────────────────────────────────
// Expo export sobreescribe el web/index.html con su propio template mínimo,
// eliminando cualquier meta tag que añadamos allí. La solución es leer el
// index.html generado e inyectar los tags PWA en tiempo de servicio.

const INDEX_HTML_PATH = path.join(DIST_DIR, "index.html");

// Tags PWA que Expo no incluye en su template generado
const PWA_TAGS = `
  <!-- ═══ PWA / iOS Safari Standalone Mode (inyectado por servidor) ═══ -->
  <link rel="manifest" href="/manifest.json" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="SpeedySign" />
  <link rel="apple-touch-icon" href="/assets/logo-transparent.png" />`;

// Script que evita que <a> tags internos abran Safari en modo standalone iOS
const PWA_SCRIPT = `
  <script>
    (function(){
      if(!window.navigator.standalone)return;
      var o=window.location.protocol+'//'+window.location.hostname;
      document.addEventListener('click',function(e){
        var n=e.target;
        while(n){if(n.nodeName==='A')break;n=n.parentNode;}
        if(!n||!n.href)return;
        if(n.href.indexOf(o)!==0)return;
        e.preventDefault();
        if(n.href!==window.location.href){
          window.history.pushState(null,'',n.href);
          window.dispatchEvent(new PopStateEvent('popstate',{state:null}));
        }
      },true);
    })();
  </script>`;

let cachedIndexHtml: string | null = null;

function getIndexHtml(): string {
    if (cachedIndexHtml) return cachedIndexHtml;
    try {
        let html = fs.readFileSync(INDEX_HTML_PATH, "utf8");
        // Inyectar tags PWA justo antes de </head>
        html = html.replace("</head>", `${PWA_TAGS}\n</head>`);
        // Inyectar script standalone justo antes de </body>
        html = html.replace("</body>", `${PWA_SCRIPT}\n</body>`);
        cachedIndexHtml = html;
        return html;
    } catch {
        return "";
    }
}

if (fs.existsSync(DIST_DIR)) {
    app.get("*", (req, res) => {
        const skip = ["/api/", "/signed/", "/manifest/", "/download/", "/proxy"];
        if (!skip.some((p) => req.path.startsWith(p))) {
            const html = getIndexHtml();
            if (html) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.send(html);
            } else {
                res.sendFile(INDEX_HTML_PATH);
            }
        } else {
            res.status(404).json({ error: "No encontrado" });
        }
    });
}


// ── Iniciar ────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
    const localIP = getLocalIP();
    console.log(`
╔═══════════════════════════════════════════════════╗
║         🚀 SpeedySign Signing Server              ║
╠═══════════════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}                  ║
║  Red:     http://${localIP}:${PORT}${" ".repeat(Math.max(0, 20 - String(localIP).length))}║
╠═══════════════════════════════════════════════════╣
║  Status:  http://localhost:${PORT}/api/status       ║
║  Firmar:  POST http://localhost:${PORT}/api/sign    ║
╠═══════════════════════════════════════════════════╣
║  🔒 Helmet: ON  │  Rate Limit: ON  │  CORS: ON   ║
║  🔒 CSP:   ON   │  Auth JWT:   ON  │  SSRF: ON   ║
╚═══════════════════════════════════════════════════╝
    `);
    console.log("✅ Servidor iniciado\n");
});
