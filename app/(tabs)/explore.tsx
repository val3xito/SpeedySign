/**
 * explore.tsx - Pantalla Explorar (catálogo global)
 * Muestra un grid agregado de todas las apps de los repos habilitados.
 * - Carga repos en lotes para evitar saturar la red.
 * - Muestra repos fallidos con botón de reintentar.
 * - Caché offline: muestra datos cacheados mientras recarga en segundo plano.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
    View,
    Text,
    FlatList,
    TextInput,
    ActivityIndicator,
    Pressable,
    useWindowDimensions,
    Linking,
    Modal,
    KeyboardAvoidingView,
    Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter, useNavigation } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import Animated, { FadeIn } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useRepos } from "../../hooks/useRepos";
import { AppCard } from "../../components/AppCard";
import { ScrollToTopButton } from "../../components/ScrollToTopButton";
import { AppItem } from "../../constants/defaultRepos";
import { fetchRepoData, FetchRepoResult, invalidateRepoCache } from "../../utils/repoParser";
import { buildIndex, search, clearIndex } from "../../utils/searchIndex";
import { useHeaderHeight } from "@react-navigation/elements";
import { notify } from "../../utils/notify";
import { useTranslation } from "react-i18next";
import { supabase } from "../../utils/supabase";
import { getSigningServerURL } from "../../utils/ipaDownloader";

interface FailedRepo {
    id: string;
    name: string;
    url: string;
    error: string;
}

export default function ExploreScreen() {
    const { colors, isDark } = useTheme();
    const { enabledRepos, loading: reposLoading } = useRepos();
    const router = useRouter();
    const navigation = useNavigation();
    const headerHeight = useHeaderHeight();
    const { width } = useWindowDimensions();
    const { t } = useTranslation();

    const [allApps, setAllApps] = useState<AppItem[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showSearch, setShowSearch] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadProgress, setLoadProgress] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [failedRepos, setFailedRepos] = useState<FailedRepo[]>([]);
    const [showFailedRepos, setShowFailedRepos] = useState(false);
    const [brokenAppIcons, setBrokenAppIcons] = useState<string[]>([]);
    const hasLoadedRef = useRef(false);
    const isLoadingRef = useRef(false);
    const lastLoadedRepoKeyRef = useRef<string>("");

    // Estados para importación mediante Enlace / Google Drive
    const [importModalVisible, setImportModalVisible] = useState(false);
    const [importMode, setImportMode] = useState<'select' | 'link'>('select');
    const [urlInput, setUrlInput] = useState("");
    const [urlAppName, setUrlAppName] = useState("");
    const [isResolvingUrl, setIsResolvingUrl] = useState(false);

    const enabledRepoKey = useMemo(
        () => enabledRepos.map((r) => r.id).sort().join(","),
        [enabledRepos]
    );

    const [showScrollTop, setShowScrollTop] = useState(false);
    const flatListRef = useRef<FlatList>(null);

    const isTablet = width > 768;
    const numColumns = isTablet ? 3 : 2;

    const loadAllApps = useCallback(async (isRefresh = false, reposToLoad?: typeof enabledRepos) => {
        if (reposLoading || isLoadingRef.current) return;
        if (!isRefresh && hasLoadedRef.current && allApps.length > 0 && lastLoadedRepoKeyRef.current === enabledRepoKey) return;

        isLoadingRef.current = true;
        const repos = reposToLoad ?? enabledRepos;

        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        setLoadProgress("Iniciando...");
        setFailedRepos([]);

        const collectedApps: AppItem[] = isRefresh ? [] : [...allApps];
        const failed: FailedRepo[] = [];
        const BATCH_SIZE = 5;
        const TIMEOUT_MS = 10000;
        const totalCount = repos.length;

        try {
            for (let i = 0; i < repos.length; i += BATCH_SIZE) {
                const batch = repos.slice(i, i + BATCH_SIZE);
                const batchNum = Math.min(i + BATCH_SIZE, totalCount);
                setLoadProgress(`${batchNum} / ${totalCount} repos`);

                const batchPromises = batch.map(async (repo) => {
                    try {
                        const result = await Promise.race<FetchRepoResult | null>([
                            fetchRepoData(repo.url, true),
                            new Promise<null>((resolve) =>
                                setTimeout(() => resolve(null), TIMEOUT_MS)
                            ),
                        ]);

                        if (!result || !result.data) {
                            failed.push({
                                id:    repo.id,
                                name:  repo.name,
                                url:   repo.url,
                                error: result?.error ?? "Timeout",
                            });
                            return null;
                        }

                        // Tag apps con info del repo
                        result.data.apps.forEach((app) => {
                            app.repoName  = repo.name;
                            app.category  = repo.category;
                        });
                        return result.data;
                    } catch {
                        failed.push({ id: repo.id, name: repo.name, url: repo.url, error: "Error desconocido" });
                        return null;
                    }
                });

                const results = await Promise.all(batchPromises);
                results.forEach((result) => {
                    if (result && result.apps.length > 0) collectedApps.push(...result.apps);
                });

                // Mostrar apps tan pronto como llegan
                if (collectedApps.length > 0) {
                    setAllApps([...collectedApps]);
                    setLoading(false);
                }
            }
        } catch (error) {
            console.error("Error al cargar apps:", error);
        } finally {
            setAllApps([...collectedApps]);
            setFailedRepos(failed);
            setLoading(false);
            setRefreshing(false);
            setLoadProgress("");
            isLoadingRef.current = false;
            hasLoadedRef.current = true;
            lastLoadedRepoKeyRef.current = enabledRepoKey;
        }
    }, [enabledRepos, reposLoading, enabledRepoKey]);

    /** Reintenta cargar solo los repos que fallaron */
    const retryFailedRepos = useCallback(async () => {
        if (!failedRepos.length || isLoadingRef.current) return;

        // Invalidar caché de repos fallidos para forzar recarga desde red
        await Promise.all(failedRepos.map((r) => invalidateRepoCache(r.url)));

        const reposToRetry = enabledRepos.filter((r) =>
            failedRepos.some((f) => f.id === r.id)
        );

        setFailedRepos([]);
        await loadAllApps(false, reposToRetry);
    }, [failedRepos, enabledRepos, loadAllApps]);

    useEffect(() => {
        loadAllApps();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabledRepoKey, reposLoading]);

    // Escuchar el evento de enfoque para recargar si hay cambios en los repositorios al navegar de vuelta
    useEffect(() => {
        const unsubscribe = navigation.addListener("focus", () => {
            if (lastLoadedRepoKeyRef.current !== enabledRepoKey || allApps.length === 0) {
                loadAllApps();
            }
        });
        return unsubscribe;
    }, [navigation, enabledRepoKey, allApps.length, loadAllApps]);

    // Reconstruir índice cuando cambia el catálogo completo
    useEffect(() => {
        if (allApps.length > 0) buildIndex(allApps);
        else clearIndex();
    }, [allApps]);

    // Ocultar splash screen cuando hay apps disponibles (web only)
    useEffect(() => {
        if (allApps.length > 0 && !loading) {
            window.dispatchEvent(new CustomEvent('speedysign:ready'));
        }
    }, [allApps.length, loading]);

    const filteredApps = useMemo(() => {
        return search(debouncedSearch, allApps).filter(app => !brokenAppIcons.includes(app.icon));
    }, [debouncedSearch, allApps, brokenAppIcons]);

    const handleImportLocalIPA = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: "*/*",
                copyToCacheDirectory: true,
            });
            if (result.canceled || !result.assets?.length) return;

            const file = result.assets[0];
            if (!file.name?.toLowerCase().endsWith(".ipa")) {
                notify.error("Error", "Debes seleccionar un archivo .ipa válido.");
                return;
            }

            const bytes = file.size || 0;
            let sizeStr = t("common.unknown", "Desconocido");
            if (bytes > 0) {
                if (bytes < 1024 * 1024) sizeStr = `${(bytes / 1024).toFixed(1)} KB`;
                else if (bytes < 1024 * 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                else sizeStr = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
            }

            if (bytes > 100 * 1024 * 1024) {
                notify.error(
                    t("explore.largeFileTitle", "Archivo no permitido"),
                    t("explore.largeFileBlocked", "No se aceptan archivos locales de más de 100 MB debido a limitaciones del servidor. Si necesitas firmar esta app, impórtala usando una URL de descarga directa.")
                );
                return;
            }

            router.push({
                pathname: "/app-detail/[id]",
                params: {
                    id:          "custom.import.ipa",
                    name:        file.name.replace(".ipa", ""),
                    version:     "Local",
                    icon:        "https://img.icons8.com/color/96/ipa.png",
                    description: "Archivo IPA importado localmente para ser firmado.",
                    downloadURL: file.uri,
                    size:        sizeStr,
                    repoName:    "Archivo Local",
                    category:    "sideload",
                },
            });
        } catch {
            notify.error("Error", "Ocurrió un problema al importar el archivo.");
        }
    };

    const getGoogleDriveDirectLink = (url: string): string => {
        const fileDRegex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
        const matchD = url.match(fileDRegex);
        if (matchD && matchD[1]) {
            return `https://drive.google.com/uc?export=download&id=${matchD[1]}`;
        }

        const idRegex = /[?&]id=([a-zA-Z0-9_-]+)/;
        const matchId = url.match(idRegex);
        if (matchId && matchId[1]) {
            return `https://drive.google.com/uc?export=download&id=${matchId[1]}`;
        }

        return url;
    };

    const handleImportURLIPA = async () => {
        const url = urlInput.trim();
        if (!url) {
            notify.error(t("common.error", "Error"), t("explore.errorEmptyUrl", "El enlace no puede estar vacío."));
            return;
        }

        if (!/^https?:\/\//i.test(url)) {
            notify.error(t("common.error", "Error"), t("explore.errorInvalidUrl", "Introduce una URL válida que empiece por http:// o https://."));
            return;
        }

        const normalizedUrl = getGoogleDriveDirectLink(url);

        const formatBytes = (bytes: number) => {
            if (!bytes || isNaN(bytes)) return null;
            if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
            return `${(bytes / 1048576).toFixed(1)} MB`;
        };

        let name = urlAppName.trim();
        let sizeStr = t("common.unknown", "Desconocido");

        setIsResolvingUrl(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const authHeader = session?.access_token
                ? { 'Authorization': `Bearer ${session.access_token}` }
                : {};

            const backendUrl = `${getSigningServerURL()}/api/resolve-url`;
            const response = await fetch(backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader } as any,
                body: JSON.stringify({ url: normalizedUrl })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    if (result.name && !name) {
                        name = result.name;
                    }
                    if (result.size) {
                        const formatted = formatBytes(result.size);
                        if (formatted) {
                            sizeStr = formatted;
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Error al resolver el nombre real del archivo:", err);
        } finally {
            setIsResolvingUrl(false);
        }

        if (!name) {
            const isDrive = url.includes("drive.google.com");
            if (isDrive) {
                const fileDRegex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
                const matchD = url.match(fileDRegex);
                const idRegex = /[?&]id=([a-zA-Z0-9_-]+)/;
                const matchId = url.match(idRegex);
                const docId = (matchD && matchD[1]) || (matchId && matchId[1]) || "drive";
                name = `Drive-${docId.substring(0, 6)}`;
            } else {
                try {
                    const parsedUrl = new URL(url);
                    const pathname = parsedUrl.pathname;
                    const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
                    if (filename && filename.toLowerCase().endsWith(".ipa")) {
                        name = decodeURIComponent(filename.replace(/\.ipa$/i, ""));
                    }
                } catch {
                    // Ignorar
                }
            }
        }

        if (!name) {
            name = "App Importada";
        }

        setImportModalVisible(false);
        setUrlInput("");
        setUrlAppName("");

        router.push({
            pathname: "/app-detail/[id]",
            params: {
                id:          "custom.import.ipa",
                name:        name,
                version:     "Enlace",
                icon:        url.includes("drive.google.com") 
                    ? "https://img.icons8.com/color/96/google-drive--v1.png"
                    : "https://img.icons8.com/color/96/link.png",
                description: "Aplicación importada mediante enlace externo para ser firmada.",
                downloadURL: normalizedUrl,
                size:        sizeStr,
                repoName:    "Enlace Externo",
                category:    "sideload",
            },
        });
    };

    useEffect(() => {
        navigation.setOptions({
            headerTitleAlign: "center",
            headerLeft: () => (
                <Pressable
                    onPress={() => loadAllApps(true)}
                    style={({ pressed }) => ({
                        backgroundColor: `${colors.accent}18`,
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: `${colors.accent}30`,
                        opacity: pressed ? 0.6 : 1,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        marginLeft: 16,
                    })}
                >
                    <Ionicons name="apps-outline" size={14} color={colors.accent} />
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.accent }}>
                        {filteredApps.length}
                    </Text>
                </Pressable>
            ),
            headerTitle: () => (
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
                    {t("explore.title", "Explorar Apps")}
                </Text>
            ),
            headerRight: () => (
                <View style={{ flexDirection: "row", gap: 12, marginRight: 16 }}>
                    <Pressable
                        onPress={() => { setShowSearch((prev) => !prev); if (showSearch) { setSearchTerm(""); setDebouncedSearch(""); } }}
                        style={({ pressed }) => ({
                            opacity: pressed ? 0.7 : 1,
                            width: 38, height: 38, borderRadius: 19,
                            justifyContent: "center", alignItems: "center",
                            backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.65)",
                            borderWidth: 1,
                            borderColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.8)",
                            shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
                        })}
                    >
                        <Ionicons name={showSearch ? "close" : "search"} size={20} color={colors.accent} />
                    </Pressable>

                    <Pressable
                        onPress={() => {
                            setImportMode('select');
                            setImportModalVisible(true);
                        }}
                        style={({ pressed }) => ({
                            opacity: pressed ? 0.7 : 1,
                            width: 38, height: 38, borderRadius: 19,
                            justifyContent: "center", alignItems: "center",
                            backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.65)",
                            borderWidth: 1,
                            borderColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.8)",
                            shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
                        })}
                    >
                        <Ionicons name="add" size={22} color={colors.accent} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, filteredApps.length, failedRepos.length, colors, isDark, showSearch, retryFailedRepos]);

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            {/* Barra de búsqueda */}
            {showSearch && (
                <Animated.View
                    entering={FadeIn.duration(200)}
                    style={{
                        position: "absolute", top: headerHeight, left: 0, right: 0,
                        zIndex: 20, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
                    }}
                >
                    <BlurView
                        intensity={80} tint={isDark ? "dark" : "light"}
                        style={{
                            borderRadius: 18, overflow: "hidden", borderWidth: 1,
                            borderColor: isFocused
                                ? (isDark ? "rgba(255,80,80,0.5)" : "rgba(200,40,40,0.3)")
                                : (isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.60)"),
                        }}
                    >
                        <View style={{
                            flexDirection: "row", alignItems: "center", paddingHorizontal: 14,
                            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.40)", height: 44,
                        }}>
                            <Ionicons name="search" size={18} color={isFocused ? colors.accent : colors.textSecondary} />
                            <TextInput
                                placeholder={t("explore.searchPlaceholder", "Buscar apps...")}
                                placeholderTextColor={colors.textSecondary}
                                value={searchTerm}
                                onChangeText={(text) => {
                                    // Actualiza el input de forma instantánea (sin lag)
                                    setSearchTerm(text);
                                    // Retrasa 300ms la búsqueda real para no recalcular en cada tecla, salvo si está vacío
                                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                                    if (text === "") {
                                        setDebouncedSearch("");
                                    } else {
                                        searchDebounceRef.current = setTimeout(() => {
                                            setDebouncedSearch(text);
                                        }, 300);
                                    }
                                }}
                                onFocus={() => setIsFocused(true)}
                                onBlur={() => setIsFocused(false)}
                                autoFocus={true}
                                style={{
                                    flex: 1, color: colors.text, fontSize: 16,
                                    paddingHorizontal: 10, height: "100%",
                                    // @ts-ignore
                                    outlineStyle: "none" as any,
                                }}
                            />
                            {searchTerm.length > 0 && (
                                <Pressable onPress={() => {
                                    setSearchTerm("");
                                    setDebouncedSearch("");
                                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                                }}>
                                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                                </Pressable>
                            )}
                        </View>
                        <LinearGradient
                            colors={["rgba(255,255,255,0.15)", "transparent"]}
                            style={{ position: "absolute", top: 0, left: 0, right: 0, height: 20 }}
                            pointerEvents="none"
                        />
                    </BlurView>
                </Animated.View>
            )}

            {loading && allApps.length === 0 ? (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingTop: headerHeight }}>
                    <ActivityIndicator size="large" color={colors.accent} />
                    <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>
                        {t("explore.loading", "Cargando catálogo...")}
                    </Text>
                </View>
            ) : filteredApps.length === 0 ? (
                allApps.length === 0 ? (
                    <View style={{
                        flex: 1,
                        justifyContent: "center",
                        alignItems: "center",
                        paddingHorizontal: 28,
                        paddingTop: headerHeight,
                    }}>
                        <Animated.View 
                            entering={FadeIn.duration(400)}
                            style={{
                                alignItems: "center",
                                width: "100%",
                                maxWidth: 400,
                                backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                                borderRadius: 24,
                                padding: 24,
                                borderWidth: 1,
                                borderColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
                            }}
                        >
                            <View style={{
                                width: 80,
                                height: 80,
                                borderRadius: 40,
                                backgroundColor: `${colors.accent}15`,
                                justifyContent: "center",
                                alignItems: "center",
                                marginBottom: 16,
                            }}>
                                <Ionicons name="compass-outline" size={40} color={colors.accent} />
                            </View>
                            
                            <Text style={{ 
                                color: colors.text, 
                                fontSize: 20, 
                                fontWeight: "700", 
                                textAlign: "center",
                                marginBottom: 8,
                            }}>
                                {t("explore.emptyTitle", "Catálogo Vacío")}
                            </Text>
                            
                            <Text style={{ 
                                color: colors.textSecondary, 
                                fontSize: 14, 
                                textAlign: "center", 
                                lineHeight: 20,
                                marginBottom: 24,
                            }}>
                                {t("explore.emptyDesc", "No tienes ningún repositorio activo o configurado. Agrega o activa fuentes para comenzar a explorar aplicaciones.")}
                            </Text>

                            {/* Button: Add Repos */}
                            <Pressable
                                onPress={() => router.push("/repositories")}
                                style={({ pressed }) => ({
                                    width: "100%",
                                    borderRadius: 16,
                                    overflow: "hidden",
                                    marginBottom: 12,
                                    transform: [{ scale: pressed ? 0.98 : 1 }],
                                    opacity: pressed ? 0.9 : 1,
                                })}
                            >
                                <LinearGradient
                                    colors={["#FF4D4D", "#FF1744", "#D50000"]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={{
                                        paddingVertical: 14,
                                        alignItems: "center",
                                    }}
                                >
                                    <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
                                        {t("explore.manageReposBtn", "⚙️ Gestionar Repositorios")}
                                    </Text>
                                </LinearGradient>
                            </Pressable>

                            {/* Social Buttons: Telegram & Reddit */}
                            <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
                                {/* Button: Telegram Community */}
                                <Pressable
                                    onPress={() => Linking.openURL("https://t.me/speedysign")}
                                    style={({ pressed }) => ({
                                        flex: 1,
                                        borderRadius: 16,
                                        overflow: "hidden",
                                        borderWidth: 1,
                                        borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
                                        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.6)",
                                        transform: [{ scale: pressed ? 0.98 : 1 }],
                                        opacity: pressed ? 0.8 : 1,
                                    })}
                                >
                                    <View style={{
                                        paddingVertical: 14,
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 8,
                                    }}>
                                        <Ionicons name="paper-plane" size={18} color="#26A69A" />
                                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                                            {t("explore.telegramBtnShort", "Telegram")}
                                        </Text>
                                    </View>
                                </Pressable>

                                {/* Button: Reddit Community */}
                                <Pressable
                                    onPress={() => Linking.openURL("https://www.reddit.com/r/SpeedySign/")}
                                    style={({ pressed }) => ({
                                        flex: 1,
                                        borderRadius: 16,
                                        overflow: "hidden",
                                        borderWidth: 1,
                                        borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
                                        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.6)",
                                        transform: [{ scale: pressed ? 0.98 : 1 }],
                                        opacity: pressed ? 0.8 : 1,
                                    })}
                                >
                                    <View style={{
                                        paddingVertical: 14,
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 8,
                                    }}>
                                        <Ionicons name="logo-reddit" size={18} color="#FF4500" />
                                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                                            {t("explore.redditBtn", "Reddit")}
                                        </Text>
                                    </View>
                                </Pressable>
                            </View>
                        </Animated.View>
                    </View>
                ) : (
                    <View style={{
                        flex: 1, justifyContent: "center", alignItems: "center",
                        paddingHorizontal: 40, paddingTop: headerHeight,
                    }}>
                        <Ionicons name="apps-outline" size={64} color={colors.textSecondary} />
                        <Text style={{ color: colors.textSecondary, fontSize: 16, marginTop: 12, textAlign: "center" }}>
                            {t("explore.noAppsFound", "No se encontraron apps con ese nombre.")}
                        </Text>
                    </View>
                )
            ) : (
                <FlatList
                    ref={flatListRef}
                    data={filteredApps}
                    keyExtractor={(item, index) => `${item.bundleID}-${index}`}
                    numColumns={numColumns}
                    key={numColumns}
                    contentContainerStyle={{
                        paddingHorizontal: 16,
                        paddingBottom: 120,
                        paddingTop: headerHeight + (showSearch ? 68 : 16),
                    }}
                    ListHeaderComponent={
                        <>
                            {/* Banner de Telegram */}
                            <Pressable
                                onPress={() => Linking.openURL("https://t.me/speedysign")}
                                style={({ pressed }) => ({
                                    backgroundColor: isDark ? `${colors.accent}10` : `${colors.accent}05`,
                                    borderRadius: 14,
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                    marginBottom: 12,
                                    borderWidth: 1,
                                    borderColor: isDark ? `${colors.accent}30` : `${colors.accent}15`,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 12,
                                    opacity: pressed ? 0.8 : 1,
                                    transform: [{ scale: pressed ? 0.99 : 1 }],
                                })}
                            >
                                <View style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 18,
                                    backgroundColor: `${colors.accent}20`,
                                    justifyContent: "center",
                                    alignItems: "center",
                                }}>
                                    <Ionicons name="paper-plane" size={18} color={colors.accent} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{
                                        color: colors.text,
                                        fontSize: 14,
                                        fontWeight: "600",
                                    }}>
                                        {t("explore.telegramBannerTitle", "Encuentra más repositorios en nuestro Telegram")}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} style={{ opacity: 0.7 }} />
                            </Pressable>

                            {/* Indicador de carga en curso */}
                            {loadProgress ? (
                                <Animated.View
                                    entering={FadeIn.duration(200)}
                                    style={{
                                        flexDirection: "row", justifyContent: "center",
                                        alignItems: "center", paddingVertical: 10, marginBottom: 16,
                                    }}
                                >
                                    <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 8 }} />
                                    <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>
                                        {t("explore.loadingRepos", { progress: loadProgress })}
                                    </Text>
                                </Animated.View>
                            ) : null}
                        </>
                    }
                    columnWrapperStyle={{ gap: 12 }}
                    showsVerticalScrollIndicator={false}
                    refreshing={refreshing}
                    onRefresh={() => loadAllApps(true)}
                    onScroll={(event) => {
                        setShowScrollTop(event.nativeEvent.contentOffset.y > 200);
                    }}
                    renderItem={({ item, index }) => (
                        <AppCard
                            app={item}
                            index={index}
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
                                        id:          item.bundleID,
                                        name:        item.name,
                                        version:     item.version,
                                        icon:        item.icon,
                                        description: item.description || "",
                                        downloadURL: item.downloadURL,
                                        size:        item.size || t("common.unknown", "Desconocido"),
                                        repoName:    item.repoName || "",
                                        category:    item.category,
                                    },
                                })
                            }
                        />
                    )}
                />
            )}

            <ScrollToTopButton
                visible={showScrollTop}
                onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}
                bottomOffset={118}
            />

            {/* ═══ Modal Liquid Glass de Importación ═══ */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={importModalVisible}
                onRequestClose={() => setImportModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={{ flex: 1, justifyContent: "flex-end" }}
                >
                    {/* Backdrop */}
                    <Pressable
                        style={{ flex: 1, backgroundColor: "transparent" }}
                        onPress={() => setImportModalVisible(false)}
                    />

                    {/* Glass panel */}
                    <View
                        style={{
                            borderTopLeftRadius: 28,
                            borderTopRightRadius: 28,
                            overflow: "hidden",
                            width: "100%",
                        }}
                    >
                        {/* Frosted glass background */}
                        <BlurView
                            intensity={Platform.OS === "ios" ? 80 : 100}
                            tint={isDark ? "dark" : "light"}
                            style={{
                                position: "absolute",
                                top: 0, left: 0, right: 0, bottom: 0,
                                backgroundColor: isDark
                                    ? "rgba(18,18,22,0.92)"
                                    : "rgba(245,245,250,0.88)",
                            }}
                        />

                        {/* Specular highlight */}
                        <LinearGradient
                            colors={
                                isDark
                                    ? ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.03)", "transparent"]
                                    : ["rgba(255,255,255,0.90)", "rgba(255,255,255,0.35)", "transparent"]
                            }
                            locations={[0, 0.25, 0.6]}
                            style={{
                                position: "absolute",
                                top: 0, left: 0, right: 0, height: 100,
                                borderTopLeftRadius: 28,
                                borderTopRightRadius: 28,
                            }}
                            pointerEvents="none"
                        />

                        {/* Glass border — top edge only */}
                        <View
                            style={{
                                position: "absolute",
                                top: 0, left: 0, right: 0,
                                height: 1.5,
                                backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.80)",
                                borderTopLeftRadius: 28,
                                borderTopRightRadius: 28,
                            }}
                            pointerEvents="none"
                        />

                        {/* Content */}
                        <View style={{ padding: 24, paddingTop: 14, paddingBottom: Platform.OS === 'ios' ? 40 : 24 }}>
                            {/* Drag handle */}
                            <View style={{ alignItems: "center", marginBottom: 16 }}>
                                <View
                                    style={{
                                        width: 40,
                                        height: 5,
                                        borderRadius: 3,
                                        backgroundColor: isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.15)",
                                    }}
                                />
                            </View>

                            {importMode === 'select' ? (
                                <View>
                                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                                        <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 }}>
                                            {t("explore.importTitle", "Importar Aplicación")}
                                        </Text>
                                        <Pressable
                                            onPress={() => setImportModalVisible(false)}
                                            style={{
                                                width: 32, height: 32, borderRadius: 16,
                                                backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
                                                borderWidth: 1,
                                                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.70)",
                                                alignItems: "center",
                                                justifyContent: "center",
                                            }}
                                        >
                                            <Ionicons name="close" size={18} color={colors.textSecondary} />
                                        </Pressable>
                                    </View>

                                    {/* Opción 1: Archivo Local */}
                                    <Pressable
                                        onPress={() => {
                                            setImportModalVisible(false);
                                            setTimeout(handleImportLocalIPA, 300);
                                        }}
                                        style={({ pressed }) => ({
                                            flexDirection: "row",
                                            alignItems: "center",
                                            padding: 16,
                                            borderRadius: 18,
                                            backgroundColor: pressed
                                                ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)")
                                                : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"),
                                            borderWidth: 1,
                                            borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                                            marginBottom: 12,
                                        })}
                                    >
                                        <View style={{
                                            width: 44, height: 44, borderRadius: 12,
                                            backgroundColor: `${colors.accent}15`,
                                            justifyContent: "center", alignItems: "center",
                                            marginRight: 16,
                                        }}>
                                            <Ionicons name="document-text-outline" size={24} color={colors.accent} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>
                                                {t("explore.localFileOption", "Archivo Local (.ipa)")}
                                            </Text>
                                            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                                                {t("explore.localFileDesc", "Selecciona un archivo desde tu dispositivo (máx. 100 MB).")}
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} style={{ opacity: 0.5 }} />
                                    </Pressable>

                                    {/* Opción 2: Enlace Web / Google Drive */}
                                    <Pressable
                                        onPress={() => setImportMode('link')}
                                        style={({ pressed }) => ({
                                            flexDirection: "row",
                                            alignItems: "center",
                                            padding: 16,
                                            borderRadius: 18,
                                            backgroundColor: pressed
                                                ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)")
                                                : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"),
                                            borderWidth: 1,
                                            borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                                        })}
                                    >
                                        <View style={{
                                            width: 44, height: 44, borderRadius: 12,
                                            backgroundColor: `${colors.accent}15`,
                                            justifyContent: "center", alignItems: "center",
                                            marginRight: 16,
                                        }}>
                                            <Ionicons name="link-outline" size={24} color={colors.accent} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>
                                                {t("explore.urlOption", "Enlace / Google Drive")}
                                            </Text>
                                            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                                                {t("explore.urlDesc", "Importa usando un enlace directo o compartido de Drive (máx. 500 MB).")}
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} style={{ opacity: 0.5 }} />
                                    </Pressable>
                                </View>
                            ) : (
                                <View>
                                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                                        <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 }}>
                                            {t("explore.importUrlTitle", "Importar por Enlace")}
                                        </Text>
                                        <Pressable
                                            onPress={() => !isResolvingUrl && setImportModalVisible(false)}
                                            disabled={isResolvingUrl}
                                            style={{
                                                width: 32, height: 32, borderRadius: 16,
                                                backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
                                                borderWidth: 1,
                                                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.70)",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                opacity: isResolvingUrl ? 0.3 : 1,
                                            }}
                                        >
                                            <Ionicons name="close" size={18} color={colors.textSecondary} />
                                        </Pressable>
                                    </View>

                                    {/* Input: URL */}
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>
                                        {t("explore.urlInputLabel", "Enlace de la App (URL / Google Drive)")}
                                    </Text>
                                    <View
                                        style={{
                                            borderRadius: 14,
                                            overflow: "hidden",
                                            marginBottom: 16,
                                            borderWidth: 1,
                                            borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.70)",
                                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.45)",
                                            opacity: isResolvingUrl ? 0.6 : 1,
                                        }}
                                    >
                                        <TextInput
                                            placeholder="https://drive.google.com/... o enlace directo"
                                            placeholderTextColor={isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.30)"}
                                            value={urlInput}
                                            onChangeText={setUrlInput}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            keyboardType="url"
                                            editable={!isResolvingUrl}
                                            style={{
                                                color: colors.text,
                                                fontSize: 16,
                                                padding: 14,
                                                paddingHorizontal: 16,
                                                // @ts-ignore
                                                outlineStyle: "none" as any,
                                            }}
                                        />
                                    </View>

                                    {/* Input: Nombre (Opcional) */}
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>
                                        {t("explore.urlNameLabel", "Nombre de la App (Opcional)")}
                                    </Text>
                                    <View
                                        style={{
                                            borderRadius: 14,
                                            overflow: "hidden",
                                            marginBottom: 20,
                                            borderWidth: 1,
                                            borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.70)",
                                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.45)",
                                            opacity: isResolvingUrl ? 0.6 : 1,
                                        }}
                                    >
                                        <TextInput
                                            placeholder="Ej: Mi Aplicación"
                                            placeholderTextColor={isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.30)"}
                                            value={urlAppName}
                                            onChangeText={setUrlAppName}
                                            editable={!isResolvingUrl}
                                            style={{
                                                color: colors.text,
                                                fontSize: 16,
                                                padding: 14,
                                                paddingHorizontal: 16,
                                                // @ts-ignore
                                                outlineStyle: "none" as any,
                                            }}
                                        />
                                    </View>

                                    {/* Botones de acción */}
                                    <View style={{ flexDirection: "row", gap: 12 }}>
                                        <Pressable
                                            onPress={() => setImportMode('select')}
                                            disabled={isResolvingUrl}
                                            style={({ pressed }) => ({
                                                flex: 1,
                                                borderRadius: 16,
                                                borderWidth: 1,
                                                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
                                                backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.6)",
                                                height: 52,
                                                justifyContent: "center",
                                                alignItems: "center",
                                                opacity: isResolvingUrl ? 0.5 : (pressed ? 0.8 : 1),
                                            })}
                                        >
                                            <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
                                                {t("common.back", "Atrás")}
                                            </Text>
                                        </Pressable>

                                        <Pressable
                                            onPress={handleImportURLIPA}
                                            disabled={isResolvingUrl}
                                            style={({ pressed }) => ({
                                                flex: 2,
                                                borderRadius: 16,
                                                overflow: "hidden",
                                                height: 52,
                                                opacity: isResolvingUrl ? 0.5 : (pressed ? 0.9 : 1),
                                            })}
                                        >
                                            <LinearGradient
                                                colors={["#FF4D4D", "#FF1744", "#D50000"]}
                                                start={{ x: 0, y: 0 }}
                                                end={{ x: 1, y: 1 }}
                                                style={{
                                                    flex: 1,
                                                    justifyContent: "center",
                                                    alignItems: "center",
                                                    flexDirection: "row",
                                                    gap: 8,
                                                }}
                                            >
                                                {isResolvingUrl ? (
                                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                                ) : (
                                                    <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
                                                        {t("explore.importBtn", "Importar")}
                                                    </Text>
                                                )}
                                            </LinearGradient>
                                        </Pressable>
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}
