/**
 * searchIndex.ts
 * Índice invertido en memoria para búsqueda rápida de apps cross-repo.
 *
 * buildIndex() construye el índice una vez cuando cambia el catálogo.
 * search() devuelve resultados en O(1) usando un mapa de prefijos pre-calculado
 * en lugar de iterar todos los tokens en cada búsqueda.
 */

import { AppItem } from "../constants/defaultRepos";

const MIN_TOKEN_LENGTH = 2;

interface SearchIndex {
    /** token → set de índices en el array original */
    tokens: Map<string, Set<number>>;
    /** prefijo (3 chars) → lista de tokens con ese prefijo */
    prefixMap: Map<string, string[]>;
    items: AppItem[];
}

let currentIndex: SearchIndex | null = null;

function tokenize(text: string): string[] {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

/**
 * Construye el índice invertido + mapa de prefijos.
 * Llamar cuando `allApps` cambie.
 */
export function buildIndex(apps: AppItem[]): void {
    const tokens = new Map<string, Set<number>>();
    const prefixMap = new Map<string, string[]>();

    apps.forEach((app, idx) => {
        const fields = [app.name, app.bundleID, app.description, app.repoName ?? ""];
        const allTokens = fields.flatMap(tokenize);

        allTokens.forEach((token) => {
            if (!tokens.has(token)) {
                tokens.set(token, new Set());
                // Registrar en el mapa de prefijos (3 chars)
                const prefix = token.slice(0, 3);
                if (!prefixMap.has(prefix)) prefixMap.set(prefix, []);
                prefixMap.get(prefix)!.push(token);
            }
            tokens.get(token)!.add(idx);
        });
    });

    currentIndex = { tokens, prefixMap, items: apps };
}

/**
 * Busca apps usando el índice.
 * Usa el mapa de prefijos para reducir drásticamente los candidatos comparados.
 * Si el índice no existe o el término está vacío, devuelve el array completo.
 */
export function search(query: string, fallback?: AppItem[]): AppItem[] {
    const trimmed = query.trim();

    if (!trimmed) return currentIndex?.items ?? fallback ?? [];

    if (!currentIndex) {
        if (!fallback) return [];
        const term = trimmed.toLowerCase();
        return fallback.filter(
            (a) =>
                a.name.toLowerCase().includes(term) ||
                a.bundleID.toLowerCase().includes(term) ||
                a.description.toLowerCase().includes(term)
        );
    }

    const queryTokens = tokenize(trimmed);
    if (!queryTokens.length) return currentIndex.items;

    let resultSet: Set<number> | null = null;

    for (const token of queryTokens) {
        const matching = new Set<number>();

        let candidateTokens: string[] = [];
        if (token.length < 3) {
            // Si el token es de longitud menor a 3 (ej. longitud 2 como "sp"), buscamos en todas las claves
            for (const key of currentIndex.tokens.keys()) {
                if (key.startsWith(token)) {
                    candidateTokens.push(key);
                }
            }
        } else {
            const prefix = token.slice(0, 3);
            candidateTokens = currentIndex.prefixMap.get(prefix) ?? [];
        }

        for (const candidate of candidateTokens) {
            if (candidate.startsWith(token)) {
                const indices = currentIndex.tokens.get(candidate);
                if (indices) for (const idx of indices) matching.add(idx);
            }
        }

        if (resultSet === null) {
            resultSet = matching;
        } else {
            for (const idx of resultSet) {
                if (!matching.has(idx)) resultSet.delete(idx);
            }
        }

        if (resultSet.size === 0) return [];
    }

    if (!resultSet) return currentIndex.items;

    return Array.from(resultSet).map((idx) => currentIndex!.items[idx]);
}

/**
 * Invalida el índice actual.
 */
export function clearIndex(): void {
    currentIndex = null;
}
