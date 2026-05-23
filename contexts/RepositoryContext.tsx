/**
 * RepositoryContext.tsx
 * Estado global y persistencia para los repositorios.
 * Permite que todas las pantallas compartan la misma lista de repositorios
 * y evita condiciones de carrera al guardar en AsyncStorage.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Repo, defaultRepos } from "../constants/defaultRepos";

/** Clave de almacenamiento para los repositorios */
const REPOS_STORAGE_KEY = "@vaultsign/repos";

interface RepositoryContextValue {
    repos: Repo[];
    enabledRepos: Repo[];
    loading: boolean;
    addRepo: (repo: Omit<Repo, "isDefault">) => Promise<void>;
    bulkAddRepos: (newReposList: Omit<Repo, "isDefault">[]) => Promise<void>;
    toggleRepo: (id: string) => Promise<void>;
    toggleAllRepos: (enabled: boolean) => Promise<void>;
    removeRepo: (id: string) => Promise<void>;
    updateRepo: (id: string, data: Partial<Repo>) => Promise<void>;
    resetDefaults: () => Promise<void>;
    reload: () => Promise<void>;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

export function RepositoryProvider({ children }: { children: React.ReactNode }) {
    const [repos, setRepos] = useState<Repo[]>([]);
    const [loading, setLoading] = useState(true);

    /**
     * Carga los repositorios desde AsyncStorage.
     * Si no hay datos guardados, usa los repos predeterminados.
     */
    const loadRepos = useCallback(async () => {
        try {
            setLoading(true);
            const stored = await AsyncStorage.getItem(REPOS_STORAGE_KEY);

            if (stored) {
                const parsed: Repo[] = JSON.parse(stored);
                const defaultIds = defaultRepos.map((r) => r.id);

                // Eliminar repos predeterminados que ya no existen en defaultRepos
                const filtered = parsed.filter(
                    (r) => r.isDefault ? defaultIds.includes(r.id) : true
                );

                // Añadir repos predeterminados que falten
                const missingDefaults = defaultRepos.filter(
                    (r) => !filtered.map((x) => x.id).includes(r.id)
                );

                const merged = [...filtered, ...missingDefaults];
                setRepos(merged);
            } else {
                // Primera vez: usar repos predeterminados
                setRepos(defaultRepos);
            }
        } catch (error) {
            console.error("Error al cargar repositorios:", error);
            setRepos(defaultRepos);
        } finally {
            setLoading(false);
        }
    }, []);

    // Cargar repos al montar el componente
    useEffect(() => {
        loadRepos();
    }, [loadRepos]);

    // Persistir repos automáticamente cuando cambia la lista (y ya terminó de cargar)
    useEffect(() => {
        if (!loading) {
            AsyncStorage.setItem(REPOS_STORAGE_KEY, JSON.stringify(repos)).catch((error) => {
                console.error("Error al guardar repositorios:", error);
            });
        }
    }, [repos, loading]);

    /**
     * Añade un nuevo repositorio manual.
     * @param repo - Repositorio a añadir (sin isDefault)
     */
    const addRepo = useCallback(
        async (repo: Omit<Repo, "isDefault">) => {
            const newRepo: Repo = { ...repo, isDefault: false };
            setRepos((prev) => [...prev, newRepo]);
        },
        []
    );

    /**
     * Añade múltiples repositorios de golpe de forma segura contra condiciones de carrera.
     * @param newReposList - Lista de repositorios a añadir (sin isDefault)
     */
    const bulkAddRepos = useCallback(
        async (newReposList: Omit<Repo, "isDefault">[]) => {
            setRepos((prev) => {
                const existingUrls = new Set(prev.map((r) => r.url.toLowerCase().trim()));
                const uniqueNewRepos = newReposList
                    .map((repo) => ({ ...repo, isDefault: false } as Repo))
                    .filter((repo) => {
                        const urlLower = repo.url.toLowerCase().trim();
                        if (existingUrls.has(urlLower)) {
                            return false;
                        }
                        existingUrls.add(urlLower);
                        return true;
                    });

                if (uniqueNewRepos.length === 0) {
                    return prev;
                }
                return [...prev, ...uniqueNewRepos];
            });
        },
        []
    );

    /**
     * Activa o desactiva un repositorio.
     * @param id - ID del repositorio
     */
    const toggleRepo = useCallback(
        async (id: string) => {
            setRepos((prev) =>
                prev.map((r) =>
                    r.id === id ? { ...r, enabled: !r.enabled } : r
                )
            );
        },
        []
    );

    /**
     * Elimina un repositorio.
     * @param id - ID del repositorio a eliminar
     */
    const removeRepo = useCallback(
        async (id: string) => {
            setRepos((prev) => prev.filter((r) => r.id !== id));
        },
        []
    );

    /**
     * Actualiza los datos de un repositorio existente.
     * @param id - ID del repositorio a actualizar
     * @param data - Datos parciales a actualizar
     */
    const updateRepo = useCallback(
        async (id: string, data: Partial<Repo>) => {
            setRepos((prev) =>
                prev.map((r) =>
                    r.id === id ? { ...r, ...data } : r
                )
            );
        },
        []
    );

    /**
     * Restaura los repositorios predeterminados.
     * Elimina todos los repos manuales y restablece los valores originales.
     */
    const resetDefaults = useCallback(async () => {
        setRepos(defaultRepos);
    }, []);

    /** Obtiene solo los repositorios habilitados (memoizado para evitar re-renders) */
    const enabledRepos = useMemo(() => repos.filter((r) => r.enabled), [repos]);

    /**
     * Activa o desactiva todos los repositorios a la vez.
     * @param enabled - true para activar todos, false para desactivarlos
     */
    const toggleAllRepos = useCallback(
        async (enabled: boolean) => {
            setRepos((prev) => prev.map((r) => ({ ...r, enabled })));
        },
        []
    );

    const value = useMemo(() => ({
        repos,
        enabledRepos,
        loading,
        addRepo,
        bulkAddRepos,
        toggleRepo,
        toggleAllRepos,
        removeRepo,
        updateRepo,
        resetDefaults,
        reload: loadRepos,
    }), [repos, enabledRepos, loading, addRepo, bulkAddRepos, toggleRepo, toggleAllRepos, removeRepo, updateRepo, resetDefaults, loadRepos]);

    return (
        <RepositoryContext.Provider value={value}>
            {children}
        </RepositoryContext.Provider>
    );
}

export function useRepositoryContext() {
    const context = useContext(RepositoryContext);
    if (!context) {
        throw new Error("useRepositoryContext must be used within a RepositoryProvider");
    }
    return context;
}
