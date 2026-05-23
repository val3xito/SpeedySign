import React from "react";
import { View, StyleSheet, ViewStyle, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../hooks/useTheme";

interface LiquidGlassProps {
    children: React.ReactNode;
    style?: ViewStyle;
    intensity?: number;
    cornerRadius?: number;
}

/**
 * LiquidGlass — Componente de cristal líquido premium.
 * Simula un material translúcido con profundidad óptica mediante
 * múltiples capas de gradiente, highlights especulares y bordes frost.
 */
export function LiquidGlass({
    children,
    style,
    intensity = 80,
    cornerRadius = 35,
}: LiquidGlassProps) {
    const { isDark } = useTheme();

    return (
        <View style={[styles.container, { borderRadius: cornerRadius }, style]}>

            {/* === Capa 1: Borde exterior "frost" fino === */}
            <View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        borderRadius: cornerRadius,
                        borderWidth: 1,
                        borderColor: isDark
                            ? "rgba(255,255,255,0.12)"
                            : "rgba(255,255,255,0.7)",
                        zIndex: 3,
                        pointerEvents: "none",
                    },
                ]}
            />

            {/* === Capa 2: Borde interior secundario para "grosor óptico" === */}
            <View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        borderRadius: cornerRadius - 1,
                        margin: 1,
                        borderWidth: 0.5,
                        borderColor: isDark
                            ? "rgba(255,255,255,0.06)"
                            : "rgba(255,255,255,0.35)",
                        zIndex: 3,
                        pointerEvents: "none",
                    },
                ]}
            />

            {/* === Capa 3: Blur + fondo translúcido === */}
            <BlurView
                intensity={Platform.OS === "ios" ? intensity : 100}
                tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
                style={[
                    styles.blurView,
                    {
                        backgroundColor: isDark
                            ? "rgba(15,15,15,0.55)"
                            : "rgba(255,255,255,0.45)",
                    },
                ]}
            >
                {/* === Capa 4: Specular highlight superior (luz cenital) === */}
                <LinearGradient
                    colors={
                        isDark
                            ? [
                                "rgba(255,255,255,0.14)",
                                "rgba(255,255,255,0.04)",
                                "rgba(255,255,255,0.0)",
                            ]
                            : [
                                "rgba(255,255,255,0.85)",
                                "rgba(255,255,255,0.30)",
                                "rgba(255,255,255,0.05)",
                            ]
                    }
                    locations={[0, 0.4, 1]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                />

                {/* === Capa 5: Gradiente diagonal para profundidad/refracción === */}
                <LinearGradient
                    colors={
                        isDark
                            ? [
                                "rgba(255,255,255,0.06)",
                                "rgba(255,255,255,0.0)",
                                "rgba(0,0,0,0.15)",
                            ]
                            : [
                                "rgba(255,255,255,0.4)",
                                "rgba(255,255,255,0.0)",
                                "rgba(0,0,0,0.03)",
                            ]
                    }
                    locations={[0, 0.5, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                />

                {children}
            </BlurView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        overflow: "hidden",
        // Ambient shadow — suave y difusa
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.2,
        shadowRadius: 30,
        elevation: 20,
    },
    blurView: {
        flex: 1,
        overflow: "hidden",
    },
});
