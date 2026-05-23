/**
 * colors.ts
 * Paleta de colores centralizada para SpeedySign.
 * Separada en modo oscuro (dark) y modo claro (light) para facilitar
 * el cambio de tema en toda la aplicación.
 * Tema: rojo y negro muy oscuro con sistema de colores semánticos unificado.
 */

export const Colors = {
    dark: {
        background:    "#080808",    // Negro muy oscuro — fondo principal
        card:          "#121212",    // Card oscuro — superficie elevada
        cardBorder:    "#1E1E1E",    // Borde sutil de tarjetas
        text:          "#FFFFFF",    // Texto principal blanco
        textSecondary: "#808080",    // Texto secundario gris
        accent:        "#E53935",    // Rojo intenso — CTA principal
        accentLight:   "#EF5350",    // Rojo más claro — hover / destacado
        tabBar:        "#0A0A0A",    // Tab bar negro
        tabBarBorder:  "#1A1A1A",    // Borde del tab bar
        danger:        "#FF4D4D",    // Rojo peligro — acciones destructivas
        warning:       "#F59E0B",    // Ámbar — advertencias semánticas
        success:       "#B71C1C",    // Rojo oscuro — usado internamente
    },
    light: {
        background:    "#F5F5F5",    // Fondo claro
        card:          "#FFFFFF",    // Card blanco
        cardBorder:    "#E0E0E0",    // Borde gris claro
        text:          "#1A1A1A",    // Texto oscuro
        textSecondary: "#666666",    // Texto secundario
        accent:        "#D32F2F",    // Rojo intenso (light mode)
        accentLight:   "#E53935",    // Rojo más claro
        tabBar:        "#FFFFFF",    // Tab bar blanco
        tabBarBorder:  "#E0E0E0",    // Borde del tab bar
        danger:        "#D32F2F",    // Rojo peligro
        warning:       "#D97706",    // Ámbar — advertencias semánticas
        success:       "#C62828",    // Rojo oscuro
    },
};

/** Tipo para el modo de tema */
export type ThemeMode = "dark" | "light";

/**
 * Devuelve la paleta de colores correspondiente al tema indicado.
 * @param theme - Modo de tema ("dark" o "light")
 * @returns Objeto con todos los colores del tema
 */
export function getThemeColors(theme: ThemeMode) {
    return Colors[theme];
}
