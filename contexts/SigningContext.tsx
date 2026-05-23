/**
 * SigningContext.tsx
 * Estado global del proceso de firma.
 * Permite que la burbuja flotante muestre progreso aunque el usuario
 * haya navegado fuera de la pantalla de detalle de app.
 */

import React, { createContext, useContext, useState, useRef } from "react";
import { SigningStep, getInitialSigningSteps } from "../components/SigningLog";

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
}

const SigningContext = createContext<SigningContextValue>({
    signingState: DEFAULT_STATE,
    setSigningState: () => {},
    cancelRef: { current: false },
    abortControllerRef: { current: null },
});

export function SigningProvider({ children }: { children: React.ReactNode }) {
    const [signingState, setSigningState] = useState<GlobalSigningState>(DEFAULT_STATE);
    const cancelRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    return (
        <SigningContext.Provider value={{ signingState, setSigningState, cancelRef, abortControllerRef }}>
            {children}
        </SigningContext.Provider>
    );
}

export function useSigningContext() {
    return useContext(SigningContext);
}
