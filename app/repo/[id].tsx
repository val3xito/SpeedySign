/**
 * repo/[id].tsx - Pantalla de detalle de repositorio
 * Muestra el catálogo de apps de un repositorio específico.
 * Parsea el JSON del repo y muestra las apps en un grid
 * con barra de búsqueda y layout adaptativo.
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
    View,
    Text,
    FlatList,
    TextInput,
    ActivityIndicator,
    Pressable,
    useWindowDimensions,
    Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import Animated, { FadeIn } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { AppCard } from "../../components/AppCard";
import { ScrollToTopButton } from "../../components/ScrollToTopButton";
import { AppItem } from "../../constants/defaultRepos";
import { fetchRepoData, filterApps } from "../../utils/repoParser";
import { useTranslation } from "react-i18next";

/**
 * Pantalla de catálogo de un repositorio individual.
 * Recibe la URL del repo como parámetro de navegación.
 */
export default function RepoDetailScreen() {
    const { colors, isDark } = useTheme();
    const { id, url, name, category } = useLocalSearchParams<{
        id: string;
        url: string;
        name: string;
        category?: string;
    }>();
    const router = useRouter();
    const { width } = useWindowDimensions();
    const { t } = useTranslation();

    // Estado
    const [apps, setApps] = useState<AppItem[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isFocused, setIsFocused] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [brokenAppIcons, setBrokenAppIcons] = useState<string[]>([]);
    const searchInputRef = useRef<TextInput>(null);

    // Debounce: espera 250 ms tras la última pulsación antes de filtrar
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Scroll to Top logic
    const [showScrollTop, setShowScrollTop] = useState(false);
    const flatListRef = useRef<FlatList>(null);

    // Columnas adaptativas
    const isTablet = width > 768;
    const numColumns = isTablet ? 3 : 2;

    /**
     * Carga las apps del repositorio al montar la pantalla.
     */
    useEffect(() => {
        const loadApps = async () => {
            if (!url) {
                setError(t("repos.errorInvalidUrl", "URL del repositorio no disponible."));
                setLoading(false);
                return;
            }

            try {
                const data = await fetchRepoData(url);
                if (data) {
                    // Inject category if available
                    const appsWithCategory = data.apps.map(app => ({
                        ...app,
                        category: category as "sideload" | "jailbreak" | undefined
                    }));
                    setApps(appsWithCategory);
                } else {
                    setError(
                        t("repos.errorInvalidJson", "No se pudo cargar el repositorio.")
                    );
                }
            } catch (err) {
                setError(t("repos.errorConnection", "Error de conexión."));
            } finally {
                setLoading(false);
            }
        };

        loadApps();
    }, [url]);

    // Filtrar por búsqueda — memoizado para no recalcular en cada render
    const filteredApps = useMemo(() => {
        return filterApps(apps, debouncedSearch).filter(app => !brokenAppIcons.includes(app.icon));
    }, [apps, debouncedSearch, brokenAppIcons]);
    const isSearching = debouncedSearch.trim().length > 0;

    return (
        <>
            {/* Configurar título del header con botón de búsqueda */}
            <Stack.Screen
                options={{
                    headerTitle: name || t("repos.title", "Repositorio"),
                    headerTitleAlign: "center",
                    headerRight: () => (
                        <Pressable
                            onPress={() => {
                                setShowSearch((prev) => {
                                    if (prev) {
                                        setSearchTerm("");
                                        setIsFocused(false);
                                    }
                                    return !prev;
                                });
                                setTimeout(() => searchInputRef.current?.focus(), 100);
                            }}
                            style={({ pressed }) => ({
                                marginRight: 8,
                                opacity: pressed ? 0.7 : 1,
                                width: 38,
                                height: 38,
                                borderRadius: 19,
                                justifyContent: "center",
                                alignItems: "center",
                                backgroundColor: isDark
                                    ? "rgba(255,255,255,0.10)"
                                    : "rgba(255,255,255,0.65)",
                                borderWidth: 1,
                                borderColor: isDark
                                    ? "rgba(255,255,255,0.15)"
                                    : "rgba(255,255,255,0.8)",
                                shadowColor: "#000",
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.2,
                                shadowRadius: 4,
                                elevation: 4,
                            })}
                        >
                            <Ionicons
                                name={showSearch ? "close" : "search"}
                                size={20}
                                color={colors.accent}
                            />
                        </Pressable>
                    ),
                }}
            />

            <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: 60 }}>
                {/* Barra de búsqueda — Liquid Glass (mismo estilo que explore/index) */}
                {showSearch && (
                    <Animated.View
                        entering={FadeIn.duration(200)}
                        style={{
                            paddingHorizontal: 16,
                            paddingTop: 8,
                            paddingBottom: 12,
                        }}
                    >
                        <BlurView
                            intensity={Platform.OS === "ios" ? 40 : 80}
                            tint={isDark ? "dark" : "light"}
                            style={{
                                borderRadius: 18,
                                overflow: "hidden",
                                borderWidth: 1,
                                borderColor: isFocused
                                    ? (isDark ? "rgba(255,80,80,0.5)" : "rgba(200,40,40,0.3)")
                                    : (isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.60)"),
                            }}
                        >
                            <View
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    paddingHorizontal: 14,
                                    backgroundColor: isDark
                                        ? "rgba(255,255,255,0.05)"
                                        : "rgba(255,255,255,0.40)",
                                    height: 44,
                                }}
                            >
                                <Ionicons name="search" size={18} color={isFocused ? colors.accent : colors.textSecondary} />
                                <TextInput
                                    ref={searchInputRef}
                                    placeholder={t("repos.searchPlaceholder", "Buscar en este repositorio...")}
                                    placeholderTextColor={colors.textSecondary}
                                    value={searchTerm}
                                    onChangeText={setSearchTerm}
                                    onFocus={() => setIsFocused(true)}
                                    onBlur={() => setIsFocused(false)}
                                    autoFocus={true}
                                    style={{
                                        flex: 1,
                                        color: colors.text,
                                        fontSize: 16,
                                        paddingHorizontal: 10,
                                        height: "100%",
                                        // @ts-ignore
                                        outlineStyle: "none" as any,
                                    }}
                                />
                                {searchTerm.length > 0 && (
                                    <Pressable onPress={() => setSearchTerm("")}>
                                        <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                                    </Pressable>
                                )}
                            </View>
                            {/* Specular highlight top */}
                            <LinearGradient
                                colors={["rgba(255,255,255,0.15)", "transparent"]}
                                style={{ position: "absolute", top: 0, left: 0, right: 0, height: 20 }}
                                pointerEvents="none"
                            />
                        </BlurView>
                    </Animated.View>
                )}

                {/* Contenido */}
                {loading ? (
                    <View
                        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
                    >
                        <ActivityIndicator size="large" color={colors.accent} />
                        <Text
                            style={{
                                color: colors.textSecondary,
                                marginTop: 12,
                                fontSize: 14,
                            }}
                        >
                            {t("explore.loading", "Cargando catálogo...")}
                        </Text>
                    </View>
                ) : error ? (
                    <View
                        style={{
                            flex: 1,
                            justifyContent: "center",
                            alignItems: "center",
                            paddingHorizontal: 40,
                        }}
                    >
                        <Ionicons name="alert-circle-outline" size={64} color="#FF4D4D" />
                        <Text
                            style={{
                                color: colors.textSecondary,
                                fontSize: 15,
                                marginTop: 12,
                                textAlign: "center",
                            }}
                        >
                            {error}
                        </Text>
                        <Pressable
                            onPress={() => router.back()}
                            style={{
                                marginTop: 20,
                                backgroundColor: colors.accent,
                                borderRadius: 12,
                                paddingHorizontal: 24,
                                paddingVertical: 12,
                            }}
                        >
                            <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>
                                {t("common.close", "Volver")}
                            </Text>
                        </Pressable>
                    </View>
                ) : filteredApps.length === 0 ? (
                    <View
                        style={{
                            flex: 1,
                            justifyContent: "center",
                            alignItems: "center",
                        }}
                    >
                        <Ionicons name="apps-outline" size={64} color={colors.textSecondary} />
                        <Text
                            style={{
                                color: colors.textSecondary,
                                fontSize: 15,
                                marginTop: 12,
                                textAlign: "center",
                            }}
                        >
                            {apps.length === 0
                                ? t("explore.noAppsAvailable", "Este repositorio no contiene apps.")
                                : t("explore.noAppsFound", "No se encontraron resultados.")}
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        ref={flatListRef}
                        data={filteredApps}
                        keyExtractor={(item, index) => `${item.bundleID}-${index}`}
                        numColumns={numColumns}
                        key={numColumns}
                        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
                        columnWrapperStyle={{ gap: 12 }}
                        showsVerticalScrollIndicator={false}
                        initialNumToRender={20}
                        maxToRenderPerBatch={20}
                        windowSize={5}
                        removeClippedSubviews={true}
                        onScroll={(event) => {
                            const offsetY = event.nativeEvent.contentOffset.y;
                            setShowScrollTop(offsetY > 200);
                        }}
                        scrollEventThrottle={100}
                        renderItem={({ item, index }) => (
                            <AppCard
                                app={item}
                                index={index}
                                animated={!isSearching}
                                onImageError={() => {
                                    setBrokenAppIcons(prev => {
                                        if (prev.includes(item.icon)) return prev;
                                        return [...prev, item.icon];
                                    });
                                }}
                                onPress={() =>
                                    router.push({
                                        pathname: "/app-detail/[id]",
                                        params: {
                                            id: item.bundleID,
                                            name: item.name,
                                            version: item.version,
                                            icon: item.icon,
                                            description: item.description || "",
                                            downloadURL: item.downloadURL,
                                            size: item.size || t("common.unknown", "Desconocido"),
                                            category: item.category,
                                        },
                                    })
                                }
                            />
                        )}
                    />
                )}
            </View>

            <ScrollToTopButton
                visible={showScrollTop}
                onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}
                bottomOffset={24} // No tab bar en esta pantalla
            />
        </>
    );
}
