/**
 * supabase.ts
 * Cliente de Supabase para autenticación, base de datos y almacenamiento.
 * 
 * Las credenciales se leen de variables de entorno (EXPO_PUBLIC_SUPABASE_*).
 * Nunca hardcodear URL ni key directamente en el código.
 */

import { createClient } from '@supabase/supabase-js';

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
 * Inicia sesión anónima automáticamente si no hay sesión activa.
 * Cada dispositivo recibe un ID único sin necesidad de registro manual.
 * @returns El user_id del usuario (nuevo o existente)
 */
export async function ensureAnonymousAuth(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
        return session.user.id;
    }

    // Crear sesión anónima
    const { data, error } = await supabase.auth.signInAnonymously();

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
