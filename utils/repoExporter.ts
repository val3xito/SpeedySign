/**
 * repoExporter.ts
 * Utilidades para exportar e importar listas de repositorios personalizados.
 * Permite hacer backup y restaurar repos custom como JSON.
 */

import { Repo } from "../constants/defaultRepos";

/** Schema del archivo de backup */
export interface RepoBackup {
    version: 1;
    exportedAt: string;
    repos: Array<{
        id:          string;
        name:        string;
        url:         string;
        icon:        string;
        description: string;
        category:    "jailbreak" | "sideload";
    }>;
}

/**
 * Serializa todos los repos (predeterminados y personalizados) a JSON para exportar.
 * @param repos - Lista completa de repos
 * @returns JSON string del backup
 */
export function exportAllRepos(repos: Repo[]): string {
    const backup: RepoBackup = {
        version:    1,
        exportedAt: new Date().toISOString(),
        repos:      repos.map((r) => ({
            id:          r.id,
            name:        r.name,
            url:         r.url,
            icon:        r.icon,
            description: r.description,
            category:    r.category,
        })),
    };
    return JSON.stringify(backup, null, 2);
}

/**
 * Parsea y valida un JSON de backup de repos.
 * @param json - Contenido del archivo de backup
 * @returns Array de repos importados o null si el formato es inválido
 */
export function parseRepoBackup(json: string): Omit<Repo, "enabled" | "isDefault">[] | null {
    try {
        const data = JSON.parse(json) as RepoBackup;

        if (data.version !== 1) return null;
        if (!Array.isArray(data.repos)) return null;

        const validCategories = new Set(["jailbreak", "sideload"]);

        return data.repos
            .filter((r) =>
                typeof r.id         === "string" && r.id.trim() &&
                typeof r.name       === "string" && r.name.trim() &&
                typeof r.url        === "string" && r.url.startsWith("http") &&
                validCategories.has(r.category)
            )
            .map((r) => ({
                id:          r.id,
                name:        r.name.trim(),
                url:         r.url.trim(),
                icon:        r.icon || "",
                description: r.description || "",
                category:    r.category,
            }));
    } catch {
        return null;
    }
}

/**
 * Descarga el backup como archivo JSON en el navegador web.
 */
export function downloadRepoBackupWeb(json: string): void {
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `speedysign-repos-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Lee un archivo JSON de backup desde un File web.
 */
export async function readRepoBackupFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.readAsText(file);
    });
}
