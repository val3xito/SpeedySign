/**
 * ipaService.ts
 * Servicio de inspección y modificación de IPAs antes de la firma.
 * Usa adm-zip para operaciones zip y plist para parsing de Info.plist.
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

// Importación dinámica de plist para compatibilidad CommonJS/ESM
let plistLib: any = null;
async function getPlist() {
    if (!plistLib) {
        try { plistLib = require('plist'); } catch { plistLib = null; }
    }
    return plistLib;
}

export interface IpaInfo {
    bundleId: string;
    bundleName: string;
    displayName: string;
    version: string;
    shortVersion: string;
    minOsVersion: string;
    platforms: string[];
    frameworks: string[];
    dylibs: string[];
    fileSharing: boolean;
    liquidGlass: boolean;
    deviceRestrictions: boolean;
}

export interface IpaModifications {
    bundleId?: string;
    displayName?: string;
    bundleVersion?: string;
    shortVersion?: string;
    enableFileSharing?: boolean;
    removeDeviceRestrictions?: boolean;
    liquidGlass?: boolean;
}

/**
 * Encuentra la entrada de Info.plist en un zip de IPA.
 */
function findInfoPlist(zip: AdmZip): AdmZip.IZipEntry | null {
    return zip.getEntries().find(e =>
        /^Payload\/[^/]+\.app\/Info\.plist$/.test(e.entryName)
    ) || null;
}

/**
 * Parsea un buffer de plist (XML o binary).
 * Intenta con la librería plist; fallback a regex básico para campos críticos.
 */
async function parsePlist(buffer: Buffer): Promise<Record<string, any>> {
    const plist = await getPlist();
    if (plist) {
        try {
            // Intentar XML primero
            const str = buffer.toString('utf8');
            if (str.includes('<?xml') || str.includes('<!DOCTYPE plist')) {
                return plist.parse(str) as Record<string, any>;
            }
            // Binary plist — usar bplist vía plist
            return plist.parse(buffer as any) as Record<string, any>;
        } catch (e) {
            console.warn('[ipaService] plist parse error, usando fallback regex:', e);
        }
    }
    // Fallback: regex básico para extraer campos clave de plist XML
    return parsePlistRegex(buffer.toString('utf8'));
}

function parsePlistRegex(xml: string): Record<string, any> {
    const result: Record<string, any> = {};
    const pairs = xml.matchAll(/<key>([^<]+)<\/key>\s*<(string|true|false|integer|real)>?([^<]*)<\/?/g);
    for (const m of pairs) {
        const key = m[1];
        const type = m[2];
        const val = m[3];
        if (type === 'true') result[key] = true;
        else if (type === 'false') result[key] = false;
        else result[key] = val;
    }
    return result;
}

/**
 * Serializa un objeto a XML plist.
 */
async function buildPlist(obj: Record<string, any>): Promise<string> {
    const plist = await getPlist();
    if (plist) {
        return plist.build(obj);
    }
    // Fallback: construir XML plist manual
    return buildPlistManual(obj);
}

function buildPlistManual(obj: Record<string, any>): string {
    let inner = '';
    for (const [k, v] of Object.entries(obj)) {
        inner += `\t<key>${escapeXml(k)}</key>\n`;
        if (typeof v === 'boolean') inner += `\t<${v}/>\n`;
        else if (typeof v === 'number') inner += `\t<integer>${v}</integer>\n`;
        else if (Array.isArray(v)) {
            inner += `\t<array>\n`;
            for (const item of v) inner += `\t\t<string>${escapeXml(String(item))}</string>\n`;
            inner += `\t</array>\n`;
        } else {
            inner += `\t<string>${escapeXml(String(v))}</string>\n`;
        }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${inner}</dict>
</plist>`;
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Límite de entradas ZIP para proteger contra zip bombs de entradas (millones de ficheros vacíos). */
const MAX_ZIP_ENTRIES = 50_000;

/**
 * Inspecciona un IPA y devuelve información del Info.plist.
 */
export async function inspectIPA(ipaPath: string): Promise<IpaInfo> {
    const zip = new AdmZip(ipaPath);
    const entries = zip.getEntries();

    if (entries.length > MAX_ZIP_ENTRIES) {
        throw new Error(`El IPA contiene demasiadas entradas (${entries.length}). Límite: ${MAX_ZIP_ENTRIES}.`);
    }

    const plistEntry = findInfoPlist(zip);
    if (!plistEntry) throw new Error('Info.plist no encontrado en el IPA');

    const data = await parsePlist(plistEntry.getData());

    const frameworks = entries
        .filter(e => /\.framework\/$/.test(e.entryName))
        .map(e => path.basename(e.entryName.replace(/\/$/, '')));

    const dylibs = entries
        .filter(e => e.entryName.endsWith('.dylib') && !e.entryName.includes('.framework/'))
        .map(e => path.basename(e.entryName));

    return {
        bundleId: String(data.CFBundleIdentifier || ''),
        bundleName: String(data.CFBundleName || ''),
        displayName: String(data.CFBundleDisplayName || data.CFBundleName || ''),
        version: String(data.CFBundleVersion || ''),
        shortVersion: String(data.CFBundleShortVersionString || ''),
        minOsVersion: String(data.MinimumOSVersion || ''),
        platforms: Array.isArray(data.CFBundleSupportedPlatforms) ? data.CFBundleSupportedPlatforms : [],
        frameworks,
        dylibs,
        fileSharing: Boolean(data.UIFileSharingEnabled),
        liquidGlass: data.UIDesignRequiresCompatibility === false,
        deviceRestrictions: Boolean(data.UISupportedDevices),
    };
}

/**
 * Modifica un IPA aplicando los cambios del Info.plist y genera un nuevo IPA.
 * Devuelve la ruta al IPA modificado.
 */
export async function modifyIPA(
    ipaPath: string,
    outputPath: string,
    mods: IpaModifications
): Promise<void> {
    // Si no hay nada que modificar, solo copiar
    const hasChanges = Object.values(mods).some(v => v !== undefined && v !== false);
    if (!hasChanges) {
        fs.copyFileSync(ipaPath, outputPath);
        return;
    }

    const zip = new AdmZip(ipaPath);

    // Reusar el mismo límite para modifyIPA: un IPA legítimo nunca tiene 50k entradas
    if (zip.getEntries().length > MAX_ZIP_ENTRIES) {
        throw new Error(`El IPA contiene demasiadas entradas. Límite: ${MAX_ZIP_ENTRIES}.`);
    }

    const plistEntry = findInfoPlist(zip);
    if (!plistEntry) throw new Error('Info.plist no encontrado');

    const data = await parsePlist(plistEntry.getData());

    // Aplicar modificaciones
    if (mods.bundleId)              data.CFBundleIdentifier = mods.bundleId;
    if (mods.displayName) {
        data.CFBundleDisplayName    = mods.displayName;
        data.CFBundleName           = mods.displayName;
    }
    if (mods.bundleVersion)         data.CFBundleVersion = mods.bundleVersion;
    if (mods.shortVersion)          data.CFBundleShortVersionString = mods.shortVersion;

    if (mods.enableFileSharing) {
        data.UIFileSharingEnabled                = true;
        data.LSSupportsOpeningDocumentsInPlace   = true;
        data.UISupportsDocumentBrowser           = true;
    }
    if (mods.removeDeviceRestrictions) {
        delete data.UISupportedDevices;
    }
    if (mods.liquidGlass) {
        data.UIDesignRequiresCompatibility = false;
    }

    const newPlistXml = await buildPlist(data);
    plistEntry.setData(Buffer.from(newPlistXml, 'utf8'));

    zip.writeZip(outputPath);
    console.log(`  ✏️  IPA modificado: ${path.basename(outputPath)}`);
}
