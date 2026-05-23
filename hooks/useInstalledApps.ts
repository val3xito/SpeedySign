/**
 * useInstalledApps.ts
 * Hook para gestionar el historial de apps instaladas con SpeedySign.
 * Persiste en AsyncStorage. Cada entrada guarda la info de la app
 * y la fecha de expiración del certificado usado para firmarla,
 * de forma que se puede calcular cuántos días quedan antes de la revocación.
 */

import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@speedysign/installed_apps";

/** Representa una app firmada e instalada */
export interface InstalledApp {
    id: string;                   // UUID único de este registro
    name: string;                 // Nombre de la app
    bundleId: string;             // Bundle ID (com.example.app)
    version: string;              // Versión instalada
    iconUrl: string;              // URL del icono
    ipaUrl?: string;              // URL original del IPA para re-firmar
    certId: string;               // ID del certificado usado
    certName: string;             // Nombre legible del certificado
    certExpirationDate: string;   // Fecha ISO de expiración del certificado
    installedAt: string;          // Fecha ISO de instalación
}

/**
 * Calcula los días restantes hasta la expiración del certificado.
 * Devuelve un número negativo si ya expiró.
 */
export function daysRemaining(certExpirationDate: string): number {
    const expDate = new Date(certExpirationDate);
    const now = new Date();
    const diffMs = expDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Devuelve el color y la etiqueta para los días restantes.
 */
export function getRevocationStatus(days: number): {
    color: string;
    label: string;
    urgent: boolean;
} {
    if (days <= 0) {
        return { color: "#9E9E9E", label: "Revocado", urgent: false };
    }
    if (days <= 7) {
        return { color: "#FF4D4D", label: `${days}d restantes`, urgent: true };
    }
    if (days <= 30) {
        return { color: "#FFC107", label: `${days}d restantes`, urgent: false };
    }
    return { color: "#4CAF50", label: `${days}d restantes`, urgent: false };
}

/**
 * Hook para gestionar apps instaladas en AsyncStorage.
 */
export function useInstalledApps() {
    const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
    const [loading, setLoading] = useState(true);

    /** Carga el historial de apps instaladas desde AsyncStorage */
    const loadInstalledApps = useCallback(async () => {
        try {
            setLoading(true);
            const raw = await AsyncStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed: InstalledApp[] = JSON.parse(raw);
                // Ordenar: más recientes primero
                parsed.sort(
                    (a, b) =>
                        new Date(b.installedAt).getTime() -
                        new Date(a.installedAt).getTime()
                );
                setInstalledApps(parsed);
            } else {
                setInstalledApps([]);
            }
        } catch (e) {
            console.error("Error cargando apps instaladas:", e);
            setInstalledApps([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadInstalledApps();
    }, [loadInstalledApps]);

    /**
     * Guarda un nuevo registro de instalación.
     * Si ya existe una entrada con el mismo bundleId, la reemplaza
     * (reinstalación con el certificado más reciente).
     */
    const saveInstallation = useCallback(
        async (app: Omit<InstalledApp, "id" | "installedAt">) => {
            try {
                const raw = await AsyncStorage.getItem(STORAGE_KEY);
                const existing: InstalledApp[] = raw ? JSON.parse(raw) : [];

                const newEntry: InstalledApp = {
                    ...app,
                    id: crypto.randomUUID(),
                    installedAt: new Date().toISOString(),
                };

                // Reemplazar si existe el mismo bundleId
                const filtered = existing.filter(
                    (a) => a.bundleId !== app.bundleId
                );
                const updated = [newEntry, ...filtered];

                await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                setInstalledApps(updated);
            } catch (e) {
                console.error("Error guardando instalación:", e);
            }
        },
        []
    );

    /**
     * Elimina un registro de instalación por ID.
     */
    const removeInstallation = useCallback(async (id: string) => {
        try {
            const raw = await AsyncStorage.getItem(STORAGE_KEY);
            const existing: InstalledApp[] = raw ? JSON.parse(raw) : [];
            const updated = existing.filter((a) => a.id !== id);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            setInstalledApps(updated);
        } catch (e) {
            console.error("Error eliminando instalación:", e);
        }
    }, []);

    return {
        installedApps,
        loading,
        saveInstallation,
        removeInstallation,
        reload: loadInstalledApps,
    };
}
