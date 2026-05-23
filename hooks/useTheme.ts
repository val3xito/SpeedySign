/**
 * useTheme.ts
 * Hook personalizado para gestionar el tema de la aplicación (oscuro/claro).
 * Persiste la preferencia del usuario en AsyncStorage para que se mantenga
 * entre sesiones de la app.
 */

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeMode, getThemeColors } from "../constants/colors";

/** Clave de almacenamiento para el tema */
const THEME_STORAGE_KEY = "@vaultsign/theme";

/** Tipo del contexto del tema */
interface ThemeContextType {
    theme: ThemeMode;
    colors: ReturnType<typeof getThemeColors>;
    toggleTheme: () => void;
    isDark: boolean;
}

/** Contexto React para el tema */
export const ThemeContext = createContext<ThemeContextType>({
    theme: "dark",
    colors: getThemeColors("dark"),
    toggleTheme: () => { },
    isDark: true,
});

/**
 * Hook que proporciona acceso al tema actual y función de cambio.
 * Debe usarse dentro de un ThemeProvider.
 */
export function useTheme() {
    return useContext(ThemeContext);
}

/**
 * Hook interno para gestionar el estado del tema.
 * Usado por el ThemeProvider en el layout raíz.
 * @returns Estado del tema y funciones de cambio
 */
export function useThemeState() {
    const [theme, setTheme] = useState<ThemeMode>("dark");
    const [isLoaded, setIsLoaded] = useState(false);

    /**
     * Carga el tema guardado desde AsyncStorage.
     * Si no hay tema guardado, usa "dark" por defecto.
     */
    useEffect(() => {
        (async () => {
            try {
                const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
                if (stored === "light" || stored === "dark") {
                    setTheme(stored);
                }
            } catch (error) {
                console.error("Error al cargar tema:", error);
            } finally {
                setIsLoaded(true);
            }
        })();
    }, []);

    /**
     * Alterna entre tema oscuro y claro.
     * Guarda la preferencia en AsyncStorage automáticamente.
     */
    const toggleTheme = useCallback(async () => {
        const newTheme: ThemeMode = theme === "dark" ? "light" : "dark";
        setTheme(newTheme);
        try {
            await AsyncStorage.setItem(THEME_STORAGE_KEY, newTheme);
        } catch (error) {
            console.error("Error al guardar tema:", error);
        }
    }, [theme]);

    const colors = getThemeColors(theme);
    const isDark = theme === "dark";

    return {
        theme,
        colors,
        toggleTheme,
        isDark,
        isLoaded,
    };
}
