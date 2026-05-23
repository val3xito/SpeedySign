import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../hooks/useTheme";
import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

/** Tab bar desactivado — StandaloneTabBar en _layout.tsx lo reemplaza globalmente */
const renderTabBar = () => null;

/**
 * Componente de layout de tabs.
 * Define las 4 pestañas principales de la aplicación.
 */
export default function TabLayout() {
    const { colors, isDark } = useTheme();
    const { t } = useTranslation();

    return (
        <Tabs
            tabBar={renderTabBar}
            initialRouteName="explore"
            screenOptions={{
                headerTransparent: true,
                headerBackground: () => (
                    <LinearGradient
                        colors={[
                            isDark ? "rgba(18,18,18,1)" : "rgba(245,245,247,1)",
                            isDark ? "rgba(18,18,18,0.9)" : "rgba(245,245,247,0.9)",
                            isDark ? "rgba(18,18,18,0.4)" : "rgba(245,245,247,0.4)",
                            "transparent"
                        ]}
                        locations={[0, 0.5, 0.8, 1]}
                        style={{ width: "100%", height: "150%" }}
                        pointerEvents="none"
                    />
                ),
                headerStyle: {
                    backgroundColor: "transparent",
                },
                headerTintColor: colors.text,
                headerTitleStyle: {
                    fontWeight: "700",
                    fontSize: 18,
                },
                headerShadowVisible: false,
                tabBarShowLabel: false, // Ocultar etiquetas por defecto si el diseño lo pide
            }}
        >
            {/* Repositorios — oculto de la navbar, accesible desde Ajustes */}
            <Tabs.Screen
                name="index"
                options={{
                    title: t("tabs.repos", "Repos"),
                    headerTitle: t("repos.title", "Repositorios"),
                    href: null,
                }}
            />

            {/* Tab 2: Explorar (catálogo global) */}
            <Tabs.Screen
                name="explore"
                options={{
                    title: t("tabs.explore", "Explorar"),
                    headerLeft: () => (
                        <View
                            style={{
                                backgroundColor: `${colors.accent}18`,
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: `${colors.accent}30`,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 5,
                                marginLeft: 16,
                            }}
                        >
                            <Ionicons name="apps-outline" size={14} color={colors.accent} />
                            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.accent }}>
                                ...
                            </Text>
                        </View>
                    ),
                    headerTitle: t("explore.title", "Explorar Apps"),
                    headerTitleAlign: "center",
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="compass-outline" size={size} color={color} />
                    ),
                }}
            />

            {/* Tab 3: Mis Apps instaladas */}
            <Tabs.Screen
                name="library"
                options={{
                    title: t("tabs.library", "Mis Apps"),
                    headerTitle: t("library.title", "Mis Apps"),
                    headerTitleAlign: "center",
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="grid-outline" size={size} color={color} />
                    ),
                }}
            />

            {/* Tab 4: Ajustes */}
            <Tabs.Screen
                name="settings"
                options={{
                    title: t("tabs.settings", "Ajustes"),
                    headerTitle: t("settings.title", "Ajustes"),
                    headerTitleAlign: "center",
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="settings-outline" size={size} color={color} />
                    ),
                }}
            />
        </Tabs>
    );
}
