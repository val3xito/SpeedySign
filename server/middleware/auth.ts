/**
 * auth.ts
 * Middleware de autenticación con Supabase JWT.
 *
 * Verifica el Bearer token de Supabase en cada petición protegida.
 * En desarrollo local sin Supabase configurado, asigna "local-dev" como userId.
 *
 * NOTA PARA OTA INSTALL:
 *  Los endpoints /manifest/:filename y /download/:filename NO usan este middleware
 *  porque iOS los llama directamente sin cabeceras de autenticación.
 *  La protección allí es que los nombres de archivo contienen un UUID irrepetible.
 */

import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL     = process.env.EXPO_PUBLIC_SUPABASE_URL     || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export interface AuthRequest extends Request {
    userId?: string;
}

/**
 * Middleware que exige un Bearer token de Supabase válido.
 * Adjunta req.userId con el UUID del usuario autenticado.
 *
 * En modo desarrollo sin Supabase configurado, asigna "local-dev" para
 * no bloquear el flujo de trabajo local.
 */
export async function requireAuth(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const auth = req.headers.authorization;

    if (!auth?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Autenticación requerida" });
        return;
    }

    const token = auth.slice(7);

    // Sin Supabase configurado — solo permitir en desarrollo
    if (!supabase) {
        if (process.env.NODE_ENV !== "production") {
            req.userId = "local-dev";
            next();
            return;
        }
        res.status(503).json({ error: "Servicio de autenticación no disponible" });
        return;
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            res.status(401).json({ error: "Token inválido o expirado" });
            return;
        }
        req.userId = user.id;
        next();
    } catch {
        res.status(401).json({ error: "Error al verificar autenticación" });
    }
}
