/**
 * pushNotify.ts
 * Notificaciones del navegador (Web Notifications API) para SpeedySign.
 *
 * Dispara notificaciones nativas cuando el proceso de firma termina y el usuario
 * tiene la pestaña en segundo plano o ha minimizado la PWA.
 *
 * Compatible con:
 *  - iOS 17+ en modo PWA standalone (instalada en pantalla de inicio)
 *  - Chrome/Firefox/Edge en escritorio y Android
 *  - Safari macOS 16.4+
 *
 * NO requiere Service Worker ni VAPID keys — usa la Notifications API estándar,
 * que funciona cuando la pestaña está cargada pero el usuario no la tiene activa.
 */

const ICON = "/assets/logo-transparent.png";
const APP_NAME = "SpeedySign";

/** Estado de los permisos de notificación */
export type NotificationPermission = "granted" | "denied" | "default" | "unsupported";

/**
 * Devuelve true si el entorno soporta la Notifications API.
 */
export function isNotificationSupported(): boolean {
    return (
        typeof window !== "undefined" &&
        "Notification" in window
    );
}

/**
 * Devuelve el estado actual del permiso de notificaciones.
 */
export function getNotificationPermission(): NotificationPermission {
    if (!isNotificationSupported()) return "unsupported";
    return Notification.permission as NotificationPermission;
}

/**
 * Solicita permiso de notificaciones al usuario.
 * Solo funciona si se llama desde un gesto del usuario (tap/click).
 *
 * @returns El estado del permiso tras la solicitud.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
    if (!isNotificationSupported()) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";

    try {
        const result = await Notification.requestPermission();
        return result as NotificationPermission;
    } catch {
        // Algunos navegadores no soportan la versión promesa (solo callback)
        return new Promise((resolve) => {
            Notification.requestPermission((result) => {
                resolve(result as NotificationPermission);
            });
        });
    }
}

/**
 * Muestra una notificación nativa si:
 *  1. El permiso está concedido
 *  2. El documento NO está activo/visible (el usuario está en otra pestaña o minimizó)
 *
 * Si el usuario tiene la app abierta y visible, no se muestra la notificación
 * (ya está viendo el resultado en la UI).
 *
 * @param title Título de la notificación
 * @param body Cuerpo del mensaje
 * @param onClick Callback ejecutado si el usuario toca la notificación
 */
export function showSigningDoneNotification(
    title: string,
    body: string,
    onClick?: () => void
): void {
    if (!isNotificationSupported()) return;
    if (Notification.permission !== "granted") return;

    // Solo notificar si el usuario NO está mirando la app activamente
    if (typeof document !== "undefined" && !document.hidden) return;

    try {
        const notification = new Notification(title, {
            body,
            icon: ICON,
            badge: ICON,
            tag: "speedysign-signing-done", // Reemplaza notificaciones anteriores del mismo tipo
            renotify: false,
            silent: false,
        });

        if (onClick) {
            notification.onclick = (e) => {
                e.preventDefault();
                // Llevar al usuario a la app si está en background
                if (typeof window !== "undefined") {
                    window.focus();
                }
                onClick();
                notification.close();
            };
        }

        // Auto-cerrar tras 8 segundos para no saturar el centro de notificaciones
        setTimeout(() => {
            try { notification.close(); } catch { /* ya cerrada */ }
        }, 8000);

    } catch (e) {
        // Fallo silencioso — las notificaciones nunca deben romper el flujo principal
        console.warn("[SpeedySign] No se pudo mostrar la notificación:", e);
    }
}

/**
 * Pide permiso la primera vez que el usuario inicia una firma.
 * Llamar solo desde un handler de tap/click para satisfacer el requisito
 * de "gesto del usuario" de los navegadores.
 *
 * No hace nada si el permiso ya fue concedido o denegado.
 */
export async function ensureNotificationPermission(): Promise<void> {
    if (!isNotificationSupported()) return;
    if (Notification.permission !== "default") return;
    await requestNotificationPermission();
}
