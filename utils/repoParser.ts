/**
 * repoParser.ts
 * Utilidades para obtener, validar y parsear los JSON de repositorios.
 *
 * Formatos soportados:
 *  - AltStore / SideStore   (bundleIdentifier, iconURL, versions[])
 *  - Scarlet                (bundleidentifier lowercase, icon, downloadurl)
 *  - EonHub / TrollStore    (apps[], applications[])
 *  - Simple                 (bundleID, icon, downloadURL directos)
 *
 * Caché: en memoria (TTL 5 min) + AsyncStorage (persistente, offline)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { RepoData, AppItem } from "../constants/defaultRepos";
import { repoCache } from "./cache";
import { getSigningServerURL } from "./ipaDownloader";

/** Tiempo máximo de espera por petición (ms) */
const FETCH_TIMEOUT = 6000;
/** TTL de la caché persistente en AsyncStorage (ms) */
const PERSISTENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutos
const CACHE_KEY_PREFIX = "@speedysign_repo_";

// ── Fetch helpers ──────────────────────────────────────────────────────────────

async function fetchWithTimeout(
    input: string,
    init: RequestInit = {},
    ms: number = FETCH_TIMEOUT
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Obtiene una URL manejando CORS para web.
 * Estrategia (en orden): proxy SpeedySign → fetch directo → corsproxy.io
 */
async function fetchWithCors(url: string): Promise<Response> {
    // 1. Proxy del servidor SpeedySign (evita CORS completamente)
    if (typeof window !== "undefined") {
        try {
            const base = getSigningServerURL();
            const proxyUrl = `${base}/proxy?url=${encodeURIComponent(url)}`;
            const res = await fetchWithTimeout(proxyUrl, { headers: { Accept: "application/json" } });
            const contentType = res.headers.get("content-type") || "";
            if (res.ok && !contentType.includes("text/html")) return res;
        } catch { /* proxy no disponible */ }
    }

    // 2. Fetch directo
    try {
        const res = await fetchWithTimeout(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            mode: "cors",
        });
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && !contentType.includes("text/html")) return res;
    } catch { /* CORS bloqueado o timeout */ }

    // 3. Fallback 1: api.codetabs.com
    try {
        const res = await fetchWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${url}`, {
            method: "GET",
            headers: { Accept: "application/json" },
        });
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && !contentType.includes("text/html")) return res;
    } catch { /* proxy 1 falló */ }

    // 4. Fallback 2: corsproxy.io
    try {
        const res = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(url)}`, {
            method: "GET",
            headers: { Accept: "application/json" },
        });
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && !contentType.includes("text/html")) return res;
    } catch { /* proxy 2 falló */ }

    // 5. Fallback 3: api.allorigins.win
    try {
        const res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
            method: "GET",
        });
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && !contentType.includes("text/html")) return res;
    } catch { /* proxy 3 falló */ }

    // 6. Fallback 4: thingproxy
    try {
        const res = await fetchWithTimeout(`https://thingproxy.freeboard.io/fetch/${url}`, {
            method: "GET",
        });
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && !contentType.includes("text/html")) return res;
    } catch { /* proxy 4 falló */ }

    return new Response(null, { status: 502, statusText: "Unreachable" });
}

// ── Normalización de apps ──────────────────────────────────────────────────────

/**
 * Normaliza una app de cualquier formato al AppItem unificado.
 * Soporta: AltStore, SideStore, Scarlet, EonHub, TrollStore y formatos simples.
 */
function normalizeApp(rawApp: Record<string, any>, repoUrl: string): AppItem | null {
    try {
        const name = rawApp.name;
        if (!name || typeof name !== "string") return null;

        // bundleID — múltiples variantes de campo
        const bundleID =
            rawApp.bundleIdentifier ||
            rawApp.bundleidentifier ||  // Scarlet usa lowercase
            rawApp.bundleID ||
            rawApp.bundle_id ||
            rawApp.CFBundleIdentifier || // TrollStore
            "unknown";

        // icono — múltiples variantes
        let icon =
            rawApp.iconURL ||
            rawApp.iconUrl ||
            rawApp.icon ||
            rawApp.iconUri ||
            rawApp.image ||
            rawApp.appIconURL ||
            "";

        // Filtrar apps que no tengan icono para que no salgan en la UI
        if (!icon || String(icon).trim() === "") return null;

        icon = String(icon).trim();
        // Resolver URL relativa usando la URL del repositorio como base
        if (!icon.startsWith("http") && !icon.startsWith("data:")) {
            try {
                icon = new URL(icon, repoUrl).href;
            } catch {
                return null;
            }
        }

        // descripción
        const description =
            rawApp.localizedDescription ||
            rawApp.description ||
            rawApp.subtitle ||
            rawApp.developerName ||
            rawApp.tintColor || // algunos repos sin desc usan esto
            "";

        // versión y downloadURL — desde versions[], releases[], o campos directos
        let version     = rawApp.version || rawApp.bundleVersion || "";
        let downloadURL = rawApp.downloadURL || rawApp.downloadUrl || rawApp.download_url || rawApp.ipaURL || "";
        let size        = rawApp.size || rawApp.fileSize || "";

        // AltStore/SideStore: versions[]
        if (Array.isArray(rawApp.versions) && rawApp.versions.length > 0) {
            const latest = rawApp.versions[0];
            version     = latest.version     || latest.bundleVersion || version;
            downloadURL = latest.downloadURL || latest.downloadUrl   || downloadURL;
            size        = latest.size        || latest.fileSize      || size;
        }

        // EonHub / algunos repos: releases[]
        if (Array.isArray(rawApp.releases) && rawApp.releases.length > 0) {
            const latest = rawApp.releases[0];
            version     = latest.version     || version;
            downloadURL = latest.downloadURL || latest.url || downloadURL;
            size        = latest.size        || size;
        }

        // Scarlet: assets[] con type "ipa"
        if (Array.isArray(rawApp.assets) && rawApp.assets.length > 0) {
            const ipaAsset = rawApp.assets.find((a: any) =>
                (a.type || "").toLowerCase() === "ipa" || (a.extension || "").toLowerCase() === "ipa"
            ) || rawApp.assets[0];
            downloadURL = ipaAsset.url || ipaAsset.downloadURL || downloadURL;
            size        = ipaAsset.size || size;
        }

        // Formatear tamaño si es numérico
        if (typeof size === "number") size = formatFileSize(size);

        return {
            name,
            bundleID:    String(bundleID),
            version:     String(version || "1.0"),
            icon:        String(icon),
            description: String(description),
            downloadURL: String(downloadURL),
            size:        String(size || "Desconocido"),
        };
    } catch {
        return null;
    }
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ── Caché persistente (AsyncStorage) ──────────────────────────────────────────

interface PersistentCacheEntry {
    data: RepoData;
    timestamp: number;
}

async function getPersistentCache(url: string): Promise<RepoData | null> {
    try {
        const key = CACHE_KEY_PREFIX + encodeURIComponent(url);
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;
        const entry: PersistentCacheEntry = JSON.parse(raw);
        if (Date.now() - entry.timestamp > PERSISTENT_CACHE_TTL) {
            await AsyncStorage.removeItem(key);
            return null;
        }
        return entry.data;
    } catch {
        return null;
    }
}

async function setPersistentCache(url: string, data: RepoData): Promise<void> {
    try {
        const key   = CACHE_KEY_PREFIX + encodeURIComponent(url);
        const entry: PersistentCacheEntry = { data, timestamp: Date.now() };
        await AsyncStorage.setItem(key, JSON.stringify(entry));
    } catch { /* no bloquear la UI si AsyncStorage falla */ }
}

/** Invalida la caché persistente de una URL específica. */
export async function invalidateRepoCache(url: string): Promise<void> {
    try {
        const key = CACHE_KEY_PREFIX + encodeURIComponent(url);
        await AsyncStorage.removeItem(key);
        repoCache.invalidate(url);
    } catch { }
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Valida que una URL responda con JSON que contiene apps.
 */
export async function validateRepoUrl(url: string): Promise<boolean> {
    try {
        new URL(url);
        const response = await fetchWithCors(url);
        if (!response.ok) return false;
        const text = await response.text();
        const data = JSON.parse(text);
        return data && typeof data === "object" && (Array.isArray(data.apps) || data.name);
    } catch {
        return false;
    }
}

/** Resultado extendido con info de error para mostrar en UI */
export interface FetchRepoResult {
    data: RepoData | null;
    error?: string;
    fromCache?: boolean;
}

/**
 * Obtiene y parsea el JSON de un repositorio.
 * Orden de prioridad: caché en memoria → caché AsyncStorage → red.
 * Devuelve { data, error, fromCache } para que la UI pueda mostrar estado.
 */
export async function fetchRepoData(url: string): Promise<RepoData | null>;
export async function fetchRepoData(url: string, extended: true): Promise<FetchRepoResult>;
export async function fetchRepoData(url: string, extended = false): Promise<RepoData | null | FetchRepoResult> {
    // 1. Caché en memoria (más rápida)
    const memCached = repoCache.get<RepoData>(url);
    if (memCached) {
        return extended ? { data: memCached, fromCache: true } : memCached;
    }

    // 2. Caché persistente (offline)
    const persisted = await getPersistentCache(url);
    if (persisted) {
        repoCache.set(url, persisted); // popular caché en memoria
        return extended ? { data: persisted, fromCache: true } : persisted;
    }

    // 3. Red
    try {
        const response = await fetchWithCors(url);

        if (!response.ok) {
            const errMsg = `HTTP ${response.status}`;
            return extended ? { data: null, error: errMsg } : null;
        }

        const text = await response.text();
        let data: any;
        try {
            data = JSON.parse(text);
        } catch {
            // Intento de reparación básica para JSON malformado (ej. comas sobrantes antes de ] o })
            try {
                const repairedText = text.replace(/,\s*([\]}])/g, '$1');
                data = JSON.parse(repairedText);
            } catch {
                return extended ? { data: null, error: "JSON inválido" } : null;
            }
        }

        const repoName = data.name || data.identifier || data.sourceName || "Repositorio";

        // Extraer apps de múltiples ubicaciones posibles
        let rawApps: any[] = [];
        if (Array.isArray(data.apps))         rawApps = data.apps;
        else if (Array.isArray(data.applications)) rawApps = data.applications;
        else if (Array.isArray(data.packages))     rawApps = data.packages;  // Sileo/Zebra
        else if (Array.isArray(data.tweaks))        rawApps = data.tweaks;

        const apps: AppItem[] = rawApps
            .map(app => normalizeApp(app, url))
            .filter((a): a is AppItem => a !== null);

        // Extraer icono del repositorio
        let repoIcon = data.iconURL || data.iconUrl || data.icon || data.logo || "";
        if (repoIcon && typeof repoIcon === "string") {
            repoIcon = repoIcon.trim();
            if (repoIcon && !repoIcon.startsWith("http") && !repoIcon.startsWith("data:")) {
                try {
                    repoIcon = new URL(repoIcon, url).href;
                } catch {
                    repoIcon = "";
                }
            }
        }

        // Extraer descripción del repositorio
        let repoDescription = data.subtitle || data.description || data.localizedDescription || "";
        if (repoDescription && typeof repoDescription === "string") {
            repoDescription = repoDescription.trim();
        }

        const result: RepoData = {
            name: String(repoName),
            apps,
            ...(repoIcon ? { icon: String(repoIcon) } : {}),
            ...(repoDescription ? { description: String(repoDescription) } : {}),
        };

        // Guardar en ambas cachés
        repoCache.set(url, result);
        await setPersistentCache(url, result);

        return extended ? { data: result } : result;
    } catch (e: any) {
        const errMsg = e?.name === "AbortError" ? "Timeout" : (e?.message || "Error de red");
        return extended ? { data: null, error: errMsg } : null;
    }
}

/**
 * Ejecuta promesas en lotes para controlar la concurrencia.
 */
export async function fetchInBatches<T, R>(
    items: T[],
    batchSize: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

/**
 * Filtra apps por nombre/bundleID/descripción usando un término de búsqueda.
 */
export function filterApps(apps: AppItem[], searchTerm: string): AppItem[] {
    if (!searchTerm.trim()) return apps;
    const term = searchTerm.toLowerCase().trim();
    return apps.filter(
        (app) =>
            app.name.toLowerCase().includes(term) ||
            app.bundleID.toLowerCase().includes(term) ||
            app.description.toLowerCase().includes(term)
    );
}

/**
 * Detecta inteligentemente si un repositorio es de Sideload o de Jailbreak.
 */
export function detectCategory(data: RepoData, url: string, rawData?: any): "jailbreak" | "sideload" {
    const urlLower = url.toLowerCase();
    const nameLower = (data.name || "").toLowerCase();
    const descLower = (data.description || "").toLowerCase();

    // 1. Claves explícitas de Sileo/Zebra/Cydia en el JSON original
    if (rawData) {
        if (rawData.packages || rawData.tweaks || Array.isArray(rawData.packages) || Array.isArray(rawData.tweaks)) {
            return "jailbreak";
        }
    }

    // 2. Si la URL contiene patrones comunes de repositorios de Cydia/Sileo
    if (
        urlLower.includes("cydia") ||
        urlLower.includes("sileo") ||
        urlLower.includes("zebra") ||
        urlLower.includes("apt.") ||
        urlLower.includes("/repo") ||
        urlLower.includes("havoc") ||
        urlLower.includes("chariz") ||
        urlLower.includes("bigboss")
    ) {
        if (urlLower.includes("apt.") || urlLower.includes("cydia") || urlLower.includes("sileo") || urlLower.includes("zebra") || urlLower.includes("havoc") || urlLower.includes("chariz")) {
            return "jailbreak";
        }
    }

    // 3. Palabras clave en nombre y descripción
    const jbKeywords = ["jailbreak", "tweak", "cydia", "sileo", "zebra", "deb", "unc0ver", "palera1n", "dopamine", "rootless", "rootful", "havoc", "chariz", "bigboss"];
    if (jbKeywords.some(kw => nameLower.includes(kw) || descLower.includes(kw))) {
        return "jailbreak";
    }

    // 4. Si las apps tienen extensión .deb o contienen deb/tweak en el bundleID
    if (data.apps && data.apps.length > 0) {
        const hasDeb = data.apps.some(app => {
            const dl = (app.downloadURL || "").toLowerCase();
            const bid = (app.bundleID || "").toLowerCase();
            return dl.endsWith(".deb") || dl.includes("/deb/") || dl.includes("package=") || bid.includes("tweak") || bid.startsWith("org.swift.") || bid.startsWith("me.");
        });
        if (hasDeb) return "jailbreak";
    }

    return "sideload";
}
