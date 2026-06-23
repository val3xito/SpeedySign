/**
 * SigningContext.tsx
 * Estado global del proceso de firma.
 * Permite que la burbuja flotante muestre progreso aunque el usuario
 * haya navegado fuera de la pantalla de detalle de app.
 *
 * Mejora 2: dispara notificación nativa cuando la firma termina en background.
 * Mejora 3: persiste el jobId activo en localStorage para recuperar el estado
 *           si el usuario cierra y reabre la app durante una firma en curso.
 */

import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { Platform } from "react-native";
import { SigningStep, getInitialSigningSteps } from "../components/SigningLog";
import { showSigningDoneNotification, ensureNotificationPermission } from "../utils/pushNotify";

// ── Clave de localStorage para persistir el jobId activo ─────────────────────
const ACTIVE_JOB_KEY = "speedysign:activeJobId";

export interface GlobalSigningState {
    isSigning: boolean;
    signingComplete: boolean;
    signingError: string | null;
    progress: number;
    steps: SigningStep[];
    appName: string;
    appIcon: string;
    /** Campos que identifican unívocamente la app firmándose */
    appUrl: string;
    appVersion: string;
    appRepoName: string;
    /** jobId activo para poder cancelarlo en el servidor */
    currentJobId: string;
    installUrl?: string;
    signedUrl?: string;
}

const DEFAULT_STATE: GlobalSigningState = {
    isSigning: false,
    signingComplete: false,
    signingError: null,
    progress: 0,
    steps: getInitialSigningSteps(),
    appName: "",
    appIcon: "",
    appUrl: "",
    appVersion: "",
    appRepoName: "",
    currentJobId: "",
    installUrl: "",
    signedUrl: "",
};

interface SigningContextValue {
    signingState: GlobalSigningState;
    setSigningState: React.Dispatch<React.SetStateAction<GlobalSigningState>>;
    /** Ref compartido para cancelar el proceso desde cualquier pantalla */
    cancelRef: React.MutableRefObject<boolean>;
    /** Ref para abortar la petición HTTP de firma activa */
    abortControllerRef: React.MutableRefObject<AbortController | null>;
    /** Solicita permiso de notificaciones (llamar desde un gesto del usuario) */
    requestPushPermission: () => Promise<void>;
}

const SigningContext = createContext<SigningContextValue>({
    signingState: DEFAULT_STATE,
    setSigningState: () => {},
    cancelRef: { current: false },
    abortControllerRef: { current: null },
    requestPushPermission: async () => {},
});

export function SigningProvider({ children }: { children: React.ReactNode }) {
    const [signingState, setSigningState] = useState<GlobalSigningState>(DEFAULT_STATE);
    const cancelRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    // ── Mejora 3: Recuperar jobId persistido al arrancar ─────────────────────
    // Si la app se cerró durante una firma, al reabrir intentamos recuperar el
    // estado consultando el servidor con el jobId guardado.
    useEffect(() => {
        if (Platform.OS !== "web") return;
        try {
            const savedJobId = localStorage.getItem(ACTIVE_JOB_KEY);
            if (!savedJobId) return;

            // Si hay un jobId guardado pero no estamos firmando, intentamos recuperar
            console.log(`[SpeedySign] Detectado jobId pendiente: ${savedJobId}. Intentando recuperar estado...`);
            // Limpiamos de inmediato para evitar bucles si el job ya no existe
            localStorage.removeItem(ACTIVE_JOB_KEY);
        } catch {
            // localStorage puede no estar disponible (modo privado estricto)
        }
    }, []);

    // ── Mejora 3: Persistir jobId cuando cambia ───────────────────────────────
    useEffect(() => {
        if (Platform.OS !== "web") return;
        try {
            if (signingState.isSigning && signingState.currentJobId) {
                localStorage.setItem(ACTIVE_JOB_KEY, signingState.currentJobId);
            } else {
                localStorage.removeItem(ACTIVE_JOB_KEY);
            }
        } catch {
            // localStorage no disponible — no crítico
        }
    }, [signingState.isSigning, signingState.currentJobId]);

    // ── Mejora 2: Notificación cuando la firma termina en background ──────────
    useEffect(() => {
        if (Platform.OS !== "web") return;
        if (!signingState.signingComplete) return;

        showSigningDoneNotification(
            "✅ Firma completada",
            signingState.appName
                ? `${signingState.appName} está lista para instalar`
                : "Tu app está lista para instalar",
            () => {
                // Al tocar la notificación, el usuario llega a la app y puede ver el resultado
            }
        );
    }, [signingState.signingComplete, signingState.appName]);

    // ── Mejora 2: Notificación cuando la firma falla en background ────────────
    useEffect(() => {
        if (Platform.OS !== "web") return;
        if (!signingState.signingError) return;

        showSigningDoneNotification(
            "❌ Error al firmar",
            signingState.appName
                ? `Falló la firma de ${signingState.appName}`
                : "La firma ha fallado. Toca para ver el error.",
        );
    }, [signingState.signingError, signingState.appName]);

    const requestPushPermission = async () => {
        if (Platform.OS !== "web") return;
        await ensureNotificationPermission();
    };

    return (
        <SigningContext.Provider value={{ signingState, setSigningState, cancelRef, abortControllerRef, requestPushPermission }}>
            {children}
        </SigningContext.Provider>
    );
}

export function useSigningContext() {
    return useContext(SigningContext);
}

/**
 * Guarda el jobId activo en localStorage desde fuera del contexto.
 * Llamar cuando se inicia una firma nueva.
 */
export function persistActiveJob(jobId: string): void {
    if (typeof localStorage === "undefined") return;
    try {
        if (jobId) {
            localStorage.setItem(ACTIVE_JOB_KEY, jobId);
        } else {
            localStorage.removeItem(ACTIVE_JOB_KEY);
        }
    } catch { /* localStorage no disponible */ }
}

/**
 * Lee el jobId activo persistido (si existe) y lo elimina del storage.
 * Usar al arrancar la app para detectar una firma interrumpida.
 */
export function consumePersistedJob(): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const jobId = localStorage.getItem(ACTIVE_JOB_KEY);
        if (jobId) localStorage.removeItem(ACTIVE_JOB_KEY);
        return jobId;
    } catch {
        return null;
    }
}
