/**
 * supabase.ts
 * Cliente de Supabase para autenticación, base de datos y almacenamiento.
 * 
 * Las credenciales se leen de variables de entorno (EXPO_PUBLIC_SUPABASE_*).
 * Nunca hardcodear URL ni key directamente en el código.
 */

import { createClient } from '@supabase/supabase-js';

import { Platform } from 'react-native';

// ── Configuración (desde variables de entorno) ────────────────────────────
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
        '⚠️ Supabase no configurado. Crea un archivo .env con EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY.'
    );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
});

/**
 * Obtiene un token de verificación de Cloudflare Turnstile de forma invisible en la web.
 */
async function getTurnstileToken(): Promise<string | undefined> {
    if (Platform.OS !== 'web') {
        return undefined;
    }

    const siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey) {
        console.warn('⚠️ EXPO_PUBLIC_TURNSTILE_SITE_KEY no está definida en las variables de entorno.');
        return undefined;
    }

    return new Promise((resolve) => {
        // Cargar el script de Turnstile si no está ya cargado
        const scriptId = 'cloudflare-turnstile-script';
        let script = document.getElementById(scriptId) as HTMLScriptElement | null;
        
        const initTurnstile = () => {
            const turnstile = (window as any).turnstile;
            if (!turnstile) {
                resolve(undefined);
                return;
            }

            // Crear un contenedor invisible para renderizar el widget
            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.top = '-9999px';
            container.style.left = '-9999px';
            document.body.appendChild(container);

            try {
                const widgetId = turnstile.render(container, {
                    sitekey: siteKey,
                    size: 'invisible',
                    callback: (token: string) => {
                        // Desmontar el widget y remover el contenedor
                        try {
                            turnstile.remove(widgetId);
                        } catch (e) {
                            console.error('Error al limpiar Turnstile widget:', e);
                        }
                        document.body.removeChild(container);
                        resolve(token);
                    },
                    'error-callback': (err: any) => {
                        console.error('Error en Cloudflare Turnstile:', err);
                        document.body.removeChild(container);
                        resolve(undefined);
                    }
                });
            } catch (err) {
                console.error('Excepción al renderizar Turnstile:', err);
                if (document.body.contains(container)) {
                    document.body.removeChild(container);
                }
                resolve(undefined);
            }
        };

        if (!(window as any).turnstile) {
            if (!script) {
                script = document.createElement('script');
                script.id = scriptId;
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                script.async = true;
                script.defer = true;
                script.onload = () => {
                    const checkInterval = setInterval(() => {
                        if ((window as any).turnstile) {
                            clearInterval(checkInterval);
                            initTurnstile();
                        }
                    }, 50);
                };
                script.onerror = () => {
                    console.error('No se pudo cargar el script de Cloudflare Turnstile');
                    resolve(undefined);
                };
                document.head.appendChild(script);
            } else {
                const checkInterval = setInterval(() => {
                    if ((window as any).turnstile) {
                        clearInterval(checkInterval);
                        initTurnstile();
                    }
                }, 50);
            }
        } else {
            initTurnstile();
        }
    });
}

/**
 * Inicia sesión anónima automáticamente si no hay sesión activa.
 * Cada dispositivo recibe un ID único sin necesidad de registro manual.
 * @returns El user_id del usuario (nuevo o existente)
 */
export async function ensureAnonymousAuth(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
        return session.user.id;
    }

    // Obtener el token de Turnstile de forma invisible
    const captchaToken = await getTurnstileToken();

    // Crear sesión anónima con el token si está disponible
    const signInOptions = captchaToken ? { options: { captchaToken } } : undefined;
    const { data, error } = await supabase.auth.signInAnonymously(signInOptions);

    if (error) {
        throw new Error(`Error de autenticación: ${error.message}`);
    }

    return data.user!.id;
}

/**
 * Registra el dispositivo actual en la tabla "devices".
 * Si ya existe un registro para este user_id, no lo duplica.
 */
export async function registerDevice(userId: string): Promise<void> {
    const deviceName = navigator.userAgent.includes('iPhone')
        ? 'iPhone'
        : navigator.userAgent.includes('iPad')
            ? 'iPad'
            : 'Navegador Web';

    // Verificar si ya existe un dispositivo registrado para este usuario
    const { data: existing } = await supabase
        .from('devices')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

    if (existing && existing.length > 0) return;

    await supabase.from('devices').insert({
        user_id: userId,
        device_name: deviceName,
        user_agent: navigator.userAgent,
    });
}
