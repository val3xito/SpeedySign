/**
 * _layout.tsx (raíz)
 * Layout raíz de la aplicación SpeedySign (Web Only).
 * Configura el proveedor de tema, la barra de estado,
 * y define el Stack Navigator principal que contiene
 * las pantallas de tabs y las pantallas de detalle.
 */

import React, { useEffect, useState } from "react";
import { Pressable, View, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ThemeContext, useThemeState } from "../hooks/useTheme";
import { ensureAnonymousAuth, registerDevice } from "../utils/supabase";
import { SileoToaster } from "../utils/notify";
import { StandaloneTabBar } from "../components/StandaloneTabBar";
import { SigningProvider } from "../contexts/SigningContext";
import { RepositoryProvider } from "../contexts/RepositoryContext";
import { FloatingSigningBubble } from "../components/FloatingSigningBubble";
import { WebSplash } from "../components/WebSplash";

import "../global.css";
import '../i18n/config';

/**
 * Componente raíz de la app (Web Only).
 * Envuelve toda la navegación con el ThemeProvider
 * y configura el Stack Navigator principal.
 */
export default function RootLayout() {
    const themeState = useThemeState();
    const router = useRouter();

    useEffect(() => {
        if (Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined") {
            return;
        }

        const root = document.documentElement;
        const nav = window.navigator as Navigator & { standalone?: boolean };
        const isIOS =
            /iPad|iPhone|iPod/.test(nav.userAgent) ||
            (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
        const isStandalone =
            nav.standalone === true ||
            window.matchMedia?.("(display-mode: standalone)")?.matches === true;

        root.classList.toggle("ios-standalone-pwa", isIOS && isStandalone);

        const syncViewportHeight = () => {
            const height = window.visualViewport?.height || window.innerHeight;
            if (height > 0) {
                root.style.setProperty("--app-viewport-height", `${Math.round(height)}px`);
            }
        };

        const scheduleSync = () => {
            window.requestAnimationFrame(syncViewportHeight);
        };

        scheduleSync();
        const timers = [
            window.setTimeout(scheduleSync, 250),
            window.setTimeout(scheduleSync, 1000),
        ];

        window.addEventListener("resize", scheduleSync);
        window.addEventListener("orientationchange", scheduleSync);
        window.addEventListener("pageshow", scheduleSync);
        window.addEventListener("focus", scheduleSync);
        window.visualViewport?.addEventListener("resize", scheduleSync);
        window.visualViewport?.addEventListener("scroll", scheduleSync);

        return () => {
            timers.forEach((timer) => window.clearTimeout(timer));
            window.removeEventListener("resize", scheduleSync);
            window.removeEventListener("orientationchange", scheduleSync);
            window.removeEventListener("pageshow", scheduleSync);
            window.removeEventListener("focus", scheduleSync);
            window.visualViewport?.removeEventListener("resize", scheduleSync);
            window.visualViewport?.removeEventListener("scroll", scheduleSync);
            root.classList.remove("ios-standalone-pwa");
            root.style.removeProperty("--app-viewport-height");
        };
    }, []);

    // Inicializar autenticación Supabase y registrar dispositivo
    useEffect(() => {
        (async () => {
            try {
                const uid = await ensureAnonymousAuth();
                await registerDevice(uid);
            } catch (e) {
                console.warn("Supabase auth init:", e);
            }
        })();
    }, []);

    // No renderizar hasta que el tema esté listo
    if (!themeState.isLoaded) {
        return null;
    }

    /** Botón de retroceso — circular glass (mismo estilo que search/add) */
    const BackButton = () => (
        <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                marginLeft: 8,
                width: 38,
                height: 38,
                borderRadius: 19,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: themeState.isDark
                    ? "rgba(255,255,255,0.10)"
                    : "rgba(255,255,255,0.65)",
                borderWidth: 1,
                borderColor: themeState.isDark
                    ? "rgba(255,255,255,0.15)"
                    : "rgba(255,255,255,0.8)",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.2,
                shadowRadius: 4,
                elevation: 4,
            })}
        >
            <Ionicons name="arrow-back" size={20} color={themeState.colors.accent} />
        </Pressable>
    );

    return (
        <View
            style={Platform.OS !== "web" ? { flex: 1 } : undefined}
            className={Platform.OS === "web" ? "web-root-layout" : undefined}
        >
            {/* Splash intro animado (web only) */}
            <WebSplash />
            <ThemeContext.Provider value={themeState}>
                <RepositoryProvider>
                    <SigningProvider>
                    <SileoToaster />
                {/* Barra de estado adaptativa al tema */}
                <StatusBar style={themeState.isDark ? "light" : "dark"} />

                {/* Stack Navigator principal */}
                <Stack
                    screenOptions={{
                        headerShown: false,
                        contentStyle: {
                            backgroundColor: themeState.colors.background,
                        },
                        animation: "slide_from_right",
                    }}
                >
                    {/* Pantallas principales con tabs */}
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

                    {/* Repositorios — accesible desde Ajustes con back button */}
                    <Stack.Screen
                        name="repositories"
                        options={{
                            headerShown: true,
                            headerTransparent: true,
                            headerBackground: () => (
                                <LinearGradient
                                    colors={[
                                        themeState.isDark ? "rgba(18,18,18,1)" : "rgba(245,245,247,1)",
                                        themeState.isDark ? "rgba(18,18,18,0.9)" : "rgba(245,245,247,0.9)",
                                        themeState.isDark ? "rgba(18,18,18,0.4)" : "rgba(245,245,247,0.4)",
                                        "transparent"
                                    ]}
                                    locations={[0, 0.5, 0.8, 1]}
                                    style={{ width: "100%", height: "150%" }}
                                    pointerEvents="none"
                                />
                            ),
                            headerTitle: "Repositorios",
                            headerTitleAlign: "center",
                            headerStyle: { backgroundColor: "transparent" },
                            headerTintColor: themeState.colors.accent,
                            headerTitleStyle: {
                                color: themeState.colors.text,
                                fontWeight: "700",
                                fontSize: 18,
                            },
                            headerLeft: () => <BackButton />,
                        }}
                    />

                    {/* Pantalla de detalle de repositorio */}
                    <Stack.Screen
                        name="repo/[id]"
                        options={{
                            headerShown: true,
                            headerTransparent: true,
                            headerBackground: () => (
                                <LinearGradient
                                    colors={[
                                        themeState.isDark ? "rgba(18,18,18,1)" : "rgba(245,245,247,1)",
                                        themeState.isDark ? "rgba(18,18,18,0.9)" : "rgba(245,245,247,0.9)",
                                        themeState.isDark ? "rgba(18,18,18,0.4)" : "rgba(245,245,247,0.4)",
                                        "transparent"
                                    ]}
                                    locations={[0, 0.5, 0.8, 1]}
                                    style={{ width: "100%", height: "150%" }}
                                    pointerEvents="none"
                                />
                            ),
                            headerTitle: "Repositorio",
                            headerTitleAlign: "center",
                            headerStyle: {
                                backgroundColor: "transparent",
                            },
                            headerTintColor: themeState.colors.accent,
                            headerTitleStyle: {
                                color: themeState.colors.text,
                                fontWeight: "600",
                            },
                            headerLeft: () => <BackButton />,
                        }}
                    />

                    {/* Pantalla de detalle de app + firma */}
                    <Stack.Screen
                        name="app-detail/[id]"
                        options={{
                            headerShown: true,
                            headerTransparent: true,
                            headerBackground: () => (
                                <LinearGradient
                                    colors={[
                                        themeState.isDark ? "rgba(18,18,18,1)" : "rgba(245,245,247,1)",
                                        themeState.isDark ? "rgba(18,18,18,0.9)" : "rgba(245,245,247,0.9)",
                                        themeState.isDark ? "rgba(18,18,18,0.4)" : "rgba(245,245,247,0.4)",
                                        "transparent"
                                    ]}
                                    locations={[0, 0.5, 0.8, 1]}
                                    style={{ width: "100%", height: "150%" }}
                                    pointerEvents="none"
                                />
                            ),
                            headerTitle: "Detalle de App",
                            headerTitleAlign: "center",
                            headerStyle: {
                                backgroundColor: "transparent",
                            },
                            headerTintColor: themeState.colors.accent,
                            headerTitleStyle: {
                                color: themeState.colors.text,
                                fontWeight: "600",
                            },
                            headerLeft: () => <BackButton />,
                        }}
                    />
                </Stack>

                {/* Tab bar global — visible en todas las pantallas */}
                <StandaloneTabBar />
                {/* Burbuja flotante de firma — visible fuera de la pantalla de detalle */}
                <FloatingSigningBubble />
                </SigningProvider>
                </RepositoryProvider>
            </ThemeContext.Provider>
        </View>
    );
}
