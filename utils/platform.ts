/**
 * platform.ts
 * Helpers de detección de plataforma compartidos en toda la app.
 * Centraliza la lógica para evitar duplicación y errores de copia-pega.
 */

import { Platform } from "react-native";

/**
 * Devuelve true si el dispositivo actual es iOS (nativo o web).
 *
 * Cubre tres casos:
 *  - App nativa React Native en iOS
 *  - Safari en iPhone/iPad/iPod
 *  - iPad en desktop mode (navigator.platform === "MacIntel" + touchPoints > 1)
 */
export const isIOS: boolean =
    Platform.OS === "ios" ||
    (Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)));

/**
 * Devuelve true si el usuario está navegando en modo standalone (PWA instalada
 * en la pantalla de inicio de iOS). Útil para ajustar comportamientos específicos
 * de la PWA vs Safari normal.
 */
export const isIOSStandalone: boolean =
    isIOS &&
    typeof navigator !== "undefined" &&
    (navigator as any).standalone === true;
