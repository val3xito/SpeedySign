/**
 * index.tsx - Pantalla de Repositorios (Tab principal)
 * Muestra la lista de repositorios (predeterminados + manuales).
 * Incluye barra de búsqueda, filtros por categoría (Todos/Sideload/Jailbreak),
 * y un botón flotante "+" para añadir nuevos repos por URL.
 */

import React, { useState, useMemo, useRef, useCallback } from "react";
import {
    View,
    Text,
    FlatList,
    Pressable,
    TextInput,
    Modal,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useNavigation } from "expo-router";
import { useHeaderHeight } from '@react-navigation/elements';
import * as DocumentPicker from "expo-document-picker";
import { useTheme } from "../hooks/useTheme";
import { useRepos } from "../hooks/useRepos";
import { RepoCard } from "../components/RepoCard";
import { notify } from "../utils/notify";
import { validateRepoUrl, fetchRepoData, detectCategory } from "../utils/repoParser";
import { ScrollToTopButton } from "../components/ScrollToTopButton";
import { useTranslation } from "react-i18next";

/** Tipos de filtro disponibles */
type FilterType = "todos" | "sideload" | "jailbreak";

/**
 * Pantalla principal: lista de repositorios.
 * Permite ver, buscar, filtrar, activar/desactivar y añadir repositorios.
 */
export default function ReposScreen() {
    const { colors, isDark } = useTheme();
    const { repos, loading, addRepo, bulkAddRepos, toggleRepo, toggleAllRepos, removeRepo, updateRepo } = useRepos();
    const router = useRouter();
    const navigation = useNavigation();
    const headerHeight = useHeaderHeight();
    const { t } = useTranslation();

    // Configurar los botones del header (MOVIDO MÁS ABAJO)

    // Estado de búsqueda y filtro
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showSearch, setShowSearch] = useState(false);
    const [activeFilter, setActiveFilter] = useState<FilterType>("todos");

    // Estado del modal para añadir/editar repositorio
    const [modalVisible, setModalVisible] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editingRepoId, setEditingRepoId] = useState<string | null>(null);

    const [newRepoUrl, setNewRepoUrl] = useState("");
    const [newRepoName, setNewRepoName] = useState("");
    const [newRepoCategory, setNewRepoCategory] = useState<"sideload" | "jailbreak">("sideload");
    const [validating, setValidating] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    // Estados para la importación en lote
    const [addTab, setAddTab] = useState<"manual" | "bulk">("manual");
    const [bulkText, setBulkText] = useState("");
    const [bulkCategory, setBulkCategory] = useState<"sideload" | "jailbreak">("sideload");
    const [importingBulk, setImportingBulk] = useState(false);

    // Scroll to Top logic
    const [showScrollTop, setShowScrollTop] = useState(false);
    const flatListRef = useRef<FlatList>(null);

    // Guardamos la URL original al abrir el modal de edición
    const [originalEditUrl, setOriginalEditUrl] = useState("");

    /**
     * Abre el modal para AÑADIR un nuevo repositorio.
     */
    const openAddModal = React.useCallback(() => {
        setIsEditing(false);
        setEditingRepoId(null);
        setNewRepoName("");
        setNewRepoUrl("");
        setOriginalEditUrl("");
        setNewRepoCategory("sideload");
        setAddTab("manual");
        setBulkText("");
        setBulkCategory("sideload");
        setModalVisible(true);
    }, []); // Dependencias vacías porque los setters de estado son estables

    // Configurar los botones del header (Lupa + Añadir)
    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <View style={{ flexDirection: "row", gap: 12, marginRight: 16 }}>
                    {/* Botón de Búsqueda */}
                    <Pressable
                        onPress={() => {
                            setShowSearch(prev => !prev);
                            if (showSearch) { setSearchTerm(""); setDebouncedSearch(""); }
                        }}
                        style={({ pressed }) => ({
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

                    {/* Botón de Añadir (+) */}
                    <Pressable
                        onPress={openAddModal}
                        style={({ pressed }) => ({
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
                        <Ionicons name="add" size={22} color={colors.accent} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, colors, isDark, showSearch, openAddModal]);




    /**
     * Repos filtrados por búsqueda y categoría.
     * Memoizado para evitar recálculos en cada render.
     */
    const filteredRepos = useMemo(() => {
        let result = repos;

        if (activeFilter !== "todos") {
            result = result.filter((r) => r.category === activeFilter);
        }

        if (debouncedSearch.trim()) {
            const term = debouncedSearch.toLowerCase().trim();
            result = result.filter(
                (r) =>
                    r.name.toLowerCase().includes(term) ||
                    r.description.toLowerCase().includes(term) ||
                    r.url.toLowerCase().includes(term)
            );
        }

        return result;
    }, [repos, activeFilter, debouncedSearch]);

    // Contadores por categoría
    const counts = useMemo(() => ({
        todos: repos.length,
        sideload: repos.filter((r) => r.category === "sideload").length,
        jailbreak: repos.filter((r) => r.category === "jailbreak").length,
    }), [repos]);

    /**
     * Maneja la eliminación de un repositorio (confirmación).
     */
    const handleRemoveRepo = (repo: any) => {
        notify.confirm(
            t("repos.confirmDeleteTitle", "Eliminar repositorio"),
            t("repos.confirmDeleteMsg", { name: repo.name }),
            () => removeRepo(repo.id)
        );
    };



    /**
     * Abre el modal para EDITAR un repositorio existente.
     */
    const handleEditRepo = (repo: any) => {
        console.log('[handleEditRepo] called for:', repo.name);
        setIsEditing(true);
        setEditingRepoId(repo.id);
        setNewRepoName(repo.name);
        setNewRepoUrl(repo.url);
        setOriginalEditUrl(repo.url); // Guardar URL original para comparar
        setNewRepoCategory(repo.category || "sideload");
        // Delay modal open to let the swipeable close animation finish
        // Otherwise on web the gesture handler swallows the state update
        setTimeout(() => setModalVisible(true), 100);
    };



    /**
     * Valida la URL y añade o actualiza el repositorio.
     * Al editar, solo valida la URL si ha cambiado.
     */
    const handleSaveRepo = async () => {
        if (!newRepoUrl.trim()) {
            notify.error(t("common.error", "Error"), t("repos.errorInvalidUrl", "Por favor, introduce una URL válida."));
            return;
        }
        if (!newRepoName.trim()) {
            notify.error(t("common.error", "Error"), t("repos.errorInvalidName", "Por favor, introduce un nombre para el repositorio."));
            return;
        }

        setValidating(true);

        try {
            const urlChanged = newRepoUrl.trim() !== originalEditUrl;

            // Solo validar la URL si es un repo nuevo o si la URL ha cambiado
            if (!isEditing || urlChanged) {
                const isValid = await validateRepoUrl(newRepoUrl.trim());

                if (!isValid) {
                    notify.error(
                        t("common.error", "URL no válida"),
                        t("repos.errorInvalidJson", "La URL proporcionada no responde con un JSON de repositorio válido.")
                    );
                    return;
                }
            }

            if (isEditing && editingRepoId && updateRepo) {
                // MODO EDICIÓN
                await updateRepo(editingRepoId, {
                    name: newRepoName.trim(),
                    url: newRepoUrl.trim(),
                    category: newRepoCategory,
                });
                notify.success(t("settings.done", "¡Listo!"), t("repos.successUpdated", "Repositorio actualizado correctamente."));
            } else {
                // MODO AÑADIR
                await addRepo({
                    id: `custom-${Date.now()}`,
                    name: newRepoName.trim(),
                    url: newRepoUrl.trim(),
                    icon: "https://img.icons8.com/color/96/source-code.png",
                    description: t("repos.addedManually", "Repositorio añadido manualmente"),
                    enabled: true,
                    category: newRepoCategory,
                });
                notify.success(t("settings.done", "¡Listo!"), t("repos.successAdded", "Repositorio añadido correctamente."));
            }

            setModalVisible(false);
            // Limpia campos
            setNewRepoUrl("");
            setNewRepoName("");
            setOriginalEditUrl("");
            setNewRepoCategory("sideload");
            setIsEditing(false);
            setEditingRepoId(null);

        } catch {
            notify.error(t("common.error", "Error"), t("repos.errorConnection", "No se pudo conectar con la URL."));
        } finally {
            setValidating(false);
        }
    };

    /**
     * Extrae URLs de un texto simple.
     */
    const parseUrlsFromText = (text: string): string[] => {
        const urlRegex = /(https?:\/\/[^\s,;"]+)/gi;
        const matches = text.match(urlRegex) || [];
        return Array.from(new Set(matches.map(url => url.trim())));
    };

    /**
     * Extrae repositorios de un JSON.
     */
    const extractReposFromJson = (jsonText: string): {
        url: string;
        name?: string;
        icon?: string;
        description?: string;
        category?: "jailbreak" | "sideload";
    }[] => {
        try {
            const parsed = JSON.parse(jsonText);
            
            const extractItem = (item: any) => {
                if (typeof item === "string") {
                    return { url: item.trim() };
                } else if (item && typeof item === "object" && typeof item.url === "string") {
                    const category = (item.category === "jailbreak" || item.category === "sideload") ? item.category : undefined;
                    return {
                        url: item.url.trim(),
                        name: typeof item.name === "string" ? item.name.trim() : undefined,
                        icon: typeof item.icon === "string" ? item.icon.trim() : undefined,
                        description: typeof item.description === "string" ? item.description.trim() : undefined,
                        category
                    };
                }
                return null;
            };

            if (Array.isArray(parsed)) {
                return parsed.map(extractItem).filter((x): x is any => x !== null);
            } else if (parsed && typeof parsed === "object") {
                if (Array.isArray(parsed.repos)) {
                    return parsed.repos.map(extractItem).filter((x: any): x is any => x !== null);
                }
            }
        } catch {
            // Ignorar y dejar que el analizador de texto plano se encargue
        }
        return [];
    };

    /**
     * Obtiene un nombre alternativo basado en la URL si no se puede resolver el nombre oficial.
     */
    const getFallbackName = (url: string) => {
        try {
            const parsed = new URL(url);
            let host = parsed.hostname;
            if (host.startsWith("www.")) host = host.substring(4);
            let path = parsed.pathname;
            if (path === "/" || path === "") return host;
            const parts = path.split("/").filter(Boolean);
            if (parts.length > 0) {
                const lastPart = parts[parts.length - 1];
                if (lastPart.endsWith(".json")) {
                    const nameWithoutJson = lastPart.replace(/\.json$/i, "");
                    return `${nameWithoutJson} (${host})`;
                }
                return `${lastPart} (${host})`;
            }
            return host;
        } catch {
            return t("repos.externalRepo", "Repositorio Externo");
        }
    };

    /**
     * Intenta obtener los nombres y metadatos reales de los repositorios en segundo plano de manera concurrente.
     */
    const resolveRepoNames = async (urls: string[]): Promise<{
        url: string;
        name: string;
        icon?: string;
        description?: string;
        detectedCategory?: "jailbreak" | "sideload";
    }[]> => {
        return Promise.all(urls.map(async (url) => {
            try {
                const resultPromise = fetchRepoData(url);
                const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
                const data = await Promise.race([resultPromise, timeoutPromise]);
                if (data && data.name) {
                    const category = detectCategory(data, url);
                    return {
                        url,
                        name: data.name,
                        icon: data.icon,
                        description: data.description,
                        detectedCategory: category
                    };
                }
            } catch {
                // Ignorar
            }
            return { url, name: getFallbackName(url) };
        }));
    };

    /**
     * Selecciona y lee un archivo de texto o JSON del dispositivo.
     */
    const handlePickRepoFile = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: "*/*", // Usamos */* para evitar problemas de filtrado MIME en algunas plataformas
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) {
                return;
            }

            const file = result.assets[0];
            
            // Límite de tamaño de archivo (1 MB) para evitar sobrecarga del servidor proxy y de memoria
            const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
            if (file.size && file.size > MAX_FILE_SIZE) {
                notify.error(t("common.error", "Error"), t("repos.errorFileSize", "El archivo es demasiado grande. El límite es 1 MB."));
                return;
            }

            const fileName = file.name?.toLowerCase() || "";
            if (!fileName.endsWith(".txt") && !fileName.endsWith(".json")) {
                notify.error(t("common.error", "Error"), t("repos.errorFileType", "Debes seleccionar un archivo .txt o .json."));
                return;
            }

            let fileContent = "";
            if (Platform.OS === "web") {
                const rawFile = (file as any).file as File;
                if (rawFile) {
                    fileContent = await rawFile.text();
                } else if (file.uri) {
                    const response = await fetch(file.uri);
                    fileContent = await response.text();
                }
            } else {
                const response = await fetch(file.uri);
                fileContent = await response.text();
            }

            if (!fileContent.trim()) {
                notify.error(t("common.error", "Error"), t("repos.fileEmpty", "El archivo seleccionado está vacío."));
                return;
            }

            setBulkText(fileContent);
            notify.success(t("settings.done", "¡Listo!"), t("repos.fileLoaded", "Archivo cargado correctamente."));
        } catch (error) {
            console.error("Error al cargar archivo de repos:", error);
            notify.error(t("common.error", "Error"), t("repos.errorFileRead", "No se pudo leer el archivo."));
        }
    };

    /**
     * Procesa la importación en lote de todos los repositorios válidos del texto de entrada.
     */
    const handleBulkImport = async () => {
        if (!bulkText.trim()) {
            notify.error(t("common.error", "Error"), t("repos.emptyBulkText", "Por favor, introduce URLs o carga un archivo."));
            return;
        }

        // Límite de longitud del texto pegado (200,000 caracteres) para evitar problemas de memoria local
        const MAX_TEXT_LENGTH = 200000;
        if (bulkText.length > MAX_TEXT_LENGTH) {
            notify.error(t("common.error", "Error"), t("repos.errorTextTooLarge", "El texto introducido es demasiado largo."));
            return;
        }

        // Intentar parsear como JSON primero, si no, usar texto plano
        let parsedRepos = extractReposFromJson(bulkText);
        let urls: string[] = [];

        if (parsedRepos.length > 0) {
            urls = parsedRepos.map(r => r.url);
        } else {
            urls = parseUrlsFromText(bulkText);
        }

        if (urls.length === 0) {
            notify.error(t("common.error", "Error"), t("repos.noUrlsFound", "No se encontraron URLs de repositorios válidas en el texto o archivo."));
            return;
        }

        // Límite de cantidad de URLs (100) para proteger el proxy del servidor contra denegación de servicio
        const MAX_URLS_COUNT = 100;
        if (urls.length > MAX_URLS_COUNT) {
            notify.error(t("common.error", "Error"), t("repos.errorTooManyUrls", "No puedes importar más de 100 repositorios a la vez."));
            return;
        }

        setImportingBulk(true);
        try {
            const currentRepoUrls = new Set(repos.map(r => r.url.toLowerCase().trim()));
            const newUrls = urls.filter(url => !currentRepoUrls.has(url.toLowerCase().trim()));

            if (newUrls.length === 0) {
                notify.error(t("common.error", "Error"), t("repos.allUrlsExist", "Todos los repositorios ya están agregados."));
                setImportingBulk(false);
                return;
            }

            // Notificación flotante informativa
            const msgId = notify.info(t("repos.importing", "Importando..."), t("repos.resolvingNames", { defaultValue: `Resolviendo nombres para ${newUrls.length} repositorios...`, count: newUrls.length }));

            // Intentar resolver nombres y detalles concurrentemente en 2.5 segundos
            const resolved = await resolveRepoNames(newUrls);
            notify.dismiss(msgId);

            const reposToAdd = resolved.map((item, idx) => {
                const jsonItem = parsedRepos.find(r => r.url.toLowerCase().trim() === item.url.toLowerCase().trim());
                return {
                    id: `custom-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
                    name: jsonItem?.name || item.name || getFallbackName(item.url),
                    url: item.url,
                    icon: jsonItem?.icon || item.icon || "https://img.icons8.com/color/96/source-code.png",
                    description: jsonItem?.description || item.description || t("repos.addedManually", "Repositorio añadido manualmente"),
                    enabled: true,
                    category: jsonItem?.category || item.detectedCategory || bulkCategory,
                };
            });

            await bulkAddRepos(reposToAdd);

            notify.success(t("settings.done", "¡Listo!"), t("repos.bulkAddedSuccess", { defaultValue: `Se han importado ${reposToAdd.length} repositorios correctamente.`, count: reposToAdd.length }));
            
            // Limpiar y cerrar modal
            setBulkText("");
            setModalVisible(false);
        } catch (error) {
            console.error("Error al importar en lote:", error);
            notify.error(t("common.error", "Error"), t("repos.errorImporting", "Hubo un error al procesar el lote de repositorios."));
        } finally {
            setImportingBulk(false);
        }
    };

    // ... (FilterChip component stays the same)
    const FilterChip = ({ label, filter, count }: { label: string, filter: FilterType, count: number }) => {
        const isActive = activeFilter === filter;

        return (
            <Pressable
                onPress={() => setActiveFilter(filter)}
                style={({ pressed }) => ({
                    flex: 1, // Allow to grow/shrink
                    borderRadius: 20,
                    overflow: "hidden",
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                    shadowColor: isActive ? "#FF3B30" : "#000",
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: isActive ? 0.3 : 0.1,
                    shadowRadius: 8,
                })}
            >
                {isActive ? (
                    <LinearGradient
                        colors={["#FF4D4D", "#FF1744", "#D50000"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center", // Center content
                            paddingHorizontal: 8, // Reduced padding
                            paddingVertical: 10,
                            gap: 6, // Reduced gap
                            borderRadius: 20,
                            borderWidth: 1,
                            borderColor: "rgba(255,255,255,0.2)",
                        }}
                    >
                        {/* Shine effect */}
                        <LinearGradient
                            colors={["rgba(255,255,255,0.3)", "transparent"]}
                            style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%" }}
                        />
                        <Ionicons
                            name={getIconName(label)}
                            size={16}
                            color="#FFFFFF"
                        />
                        <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            style={{
                                color: "#FFFFFF",
                                fontSize: 13,
                                fontWeight: "700",
                                flexShrink: 1
                            }}
                        >
                            {label}
                        </Text>
                        <View
                            style={{
                                backgroundColor: "rgba(255,255,255,0.25)",
                                borderRadius: 10,
                                paddingHorizontal: 6,
                                paddingVertical: 1,
                                minWidth: 20,
                                alignItems: "center",
                            }}
                        >
                            <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "700" }}>{count}</Text>
                        </View>
                    </LinearGradient>
                ) : (
                    <BlurView
                        intensity={Platform.OS === "ios" ? 30 : 50}
                        tint={isDark ? "dark" : "light"}
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center", // Center content
                            paddingHorizontal: 8, // Reduced padding
                            paddingVertical: 10,
                            gap: 6, // Reduced gap
                            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.4)",
                            borderRadius: 20,
                            borderWidth: 1,
                            borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.5)",
                        }}
                    >
                        {/* Shine effect */}
                        <LinearGradient
                            colors={isDark ? ["rgba(255,255,255,0.08)", "transparent"] : ["rgba(255,255,255,0.6)", "transparent"]}
                            style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%" }}
                        />
                        <Ionicons
                            name={getIconName(label)}
                            size={16}
                            color={colors.textSecondary}
                        />
                        <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            style={{
                                color: colors.text,
                                fontSize: 13,
                                fontWeight: "500",
                                flexShrink: 1
                            }}
                        >
                            {label}
                        </Text>
                        <View
                            style={{
                                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                                borderRadius: 10,
                                paddingHorizontal: 6,
                                paddingVertical: 1,
                                minWidth: 20,
                                alignItems: "center",
                            }}
                        >
                            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: "600" }}>{count}</Text>
                        </View>
                    </BlurView>
                )}
            </Pressable>
        );
    };

    const getIconName = (label: string) => {
        switch (label) {
            case "Todos": return "grid";
            case "Sideload": return "cube";
            case "Jailbreak": return "lock-open";
            default: return "list";
        }
    };



    if (loading) {
        return (
            <View
                style={{
                    flex: 1,
                    backgroundColor: colors.background,
                    justifyContent: "center",
                    alignItems: "center",
                }}
            >
                <ActivityIndicator size="large" color={colors.accent} />
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            {/* Barra de búsqueda (Condicional) */}
            {showSearch && (
                <Animated.View
                    entering={FadeIn.duration(200)}
                    style={{
                        position: "absolute",
                        top: headerHeight,
                        left: 0,
                        right: 0,
                        zIndex: 20,
                        paddingHorizontal: 16,
                        paddingTop: 8,
                        paddingBottom: 12
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
                                placeholder={t("repos.searchPlaceholder", "Buscar repositorios...")}
                                placeholderTextColor={colors.textSecondary}
                                value={searchTerm}
                                onChangeText={(text) => {
                                    // Actualiza el input instantáneamente (sin lag de teclado)
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
                                <Pressable onPress={() => { setSearchTerm(""); setDebouncedSearch(""); }}>
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

            {/* Filtros por categoría - Floating Liquid Glass */}
            {/* Ajustamos el top para que baje cuando la búsqueda está activa, o lo dejamos fijo? 
                Si queremos que flote "debajo" de la searchbar cuando esta aparece, necesitamos ajustar 'top'.
                Pero como 'absolute', se superpondría. 
                Mejor: El contenedor de filtros NO debe ser absolute si queremos que la lista empuje.
                PERO el usuario pidió que sean "flotantes".
                Si son flotantes, están fijos. Si abro la búsqueda, ¿deben bajar?
                Hagamos que la búsqueda empuje el contenido, y los filtros floten debajo de la búsqueda.
                O simplificar: Si la búsqueda ocupa espacio, el 'top' de los filtros debe aumentar.
            */}
            <Animated.View style={{
                position: "absolute",
                top: showSearch ? headerHeight + 56 : headerHeight,
                left: 0,
                right: 0,
                zIndex: 10,
                paddingVertical: 8,
                paddingHorizontal: 16,
            }}>
                <View style={{ flexDirection: "row", gap: 8, width: "100%" }}>
                    <FilterChip label={t("repos.filterAll", "Todos")} filter="todos" count={counts.todos} />
                    <FilterChip label={t("repos.filterSideload", "Sideload")} filter="sideload" count={counts.sideload} />
                    <FilterChip label={t("repos.filterJailbreak", "Jailbreak")} filter="jailbreak" count={counts.jailbreak} />
                </View>
            </Animated.View>

            {/* Lista de repositorios */}
            <FlatList
                ref={flatListRef}
                data={filteredRepos}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{
                    paddingHorizontal: 16,
                    paddingBottom: 120,
                    paddingTop: headerHeight + (showSearch ? 130 : 64)
                }}
                showsVerticalScrollIndicator={false}
                onScroll={(event) => {
                    const offsetY = event.nativeEvent.contentOffset.y;
                    setShowScrollTop(offsetY > 200);
                }}
                ListEmptyComponent={
                    searchTerm ? (
                        <View style={{ alignItems: "center", marginTop: 60 }}>
                            <Ionicons name="cube-outline" size={64} color={colors.textSecondary} />
                            <Text
                                style={{
                                    color: colors.textSecondary,
                                    fontSize: 16,
                                    marginTop: 12,
                                    textAlign: "center",
                                }}
                            >
                                {t("repos.emptyState", "No se encontraron repos con ese nombre.")}
                            </Text>
                        </View>
                    ) : (
                        <View style={{
                            alignItems: "center",
                            marginTop: 40,
                            paddingHorizontal: 20,
                            width: "100%",
                        }}>
                            <Animated.View 
                                entering={FadeInDown.duration(400)}
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
                                    <Ionicons name="cube-outline" size={40} color={colors.accent} />
                                </View>
                                
                                <Text style={{ 
                                    color: colors.text, 
                                    fontSize: 18, 
                                    fontWeight: "700", 
                                    textAlign: "center",
                                    marginBottom: 8,
                                }}>
                                    {t("repos.emptyStateTitle", "Sin Fuentes")}
                                </Text>
                                
                                <Text style={{ 
                                    color: colors.textSecondary, 
                                    fontSize: 14, 
                                    textAlign: "center", 
                                    lineHeight: 20,
                                    marginBottom: 24,
                                }}>
                                    {t("repos.emptyStateNoRepos", "No tienes ningún repositorio de aplicaciones configurado en tu dispositivo. Puedes añadir tus propios repositorios usando el botón superior (+) o encontrar fuentes de la comunidad en Telegram.")}
                                </Text>

                                {/* Button: Add Repo manually */}
                                <Pressable
                                    onPress={openAddModal}
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
                                            {t("repos.addRepoBtn", "➕ Añadir Repositorio")}
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
                                                {t("repos.telegramBtnShort", "Telegram")}
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
                                                {t("repos.redditBtn", "Reddit")}
                                            </Text>
                                        </View>
                                    </Pressable>
                                </View>
                            </Animated.View>
                        </View>
                    )
                }
                ListHeaderComponent={
                    filteredRepos.length > 0 ? (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
                            <Pressable
                                onPress={() => toggleAllRepos(true)}
                                style={({ pressed }) => ({
                                    flex: 1,
                                    backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                                    borderRadius: 20,
                                    paddingVertical: 10,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderWidth: 1,
                                    borderColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)",
                                    opacity: pressed ? 0.7 : 1,
                                    flexDirection: "row",
                                    gap: 6
                                })}
                            >
                                <Ionicons name="checkmark-done" size={16} color={colors.accent} />
                                <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                                    {t("repos.enableAll", "Activar Todos")}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={() => toggleAllRepos(false)}
                                style={({ pressed }) => ({
                                    flex: 1,
                                    backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                                    borderRadius: 20,
                                    paddingVertical: 10,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderWidth: 1,
                                    borderColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)",
                                    opacity: pressed ? 0.7 : 1,
                                    flexDirection: "row",
                                    gap: 6
                                })}
                            >
                                <Ionicons name="close-circle-outline" size={16} color={colors.textSecondary} />
                                <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: "600" }}>
                                    {t("repos.disableAll", "Desactivar Todos")}
                                </Text>
                            </Pressable>
                        </View>
                    ) : null
                }
                renderItem={({ item, index }) => (
                    <RepoCard
                        repo={item}
                        index={index}
                        onPress={() =>
                            router.push({
                                pathname: "/repo/[id]",
                                params: { id: item.id, url: item.url, name: item.name, category: item.category },
                            })
                        }
                        onToggle={() => toggleRepo(item.id)}
                        onEdit={() => handleEditRepo(item)}
                        onDelete={() => handleRemoveRepo(item)}
                    />
                )}
            />

            {/* Botón scroll to top — liquid glass */}
            <ScrollToTopButton
                visible={showScrollTop}
                onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}
                bottomOffset={118}
            />

            {/* ═══ Modal Liquid Glass ═══ */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={{ flex: 1, justifyContent: "flex-end" }}
                >
                    {/* Backdrop */}
                    <Pressable
                        style={{ flex: 1 }}
                        onPress={() => setModalVisible(false)}
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
                        <View style={{ padding: 24, paddingTop: 14 }}>
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

                            {/* Header */}
                            <View
                                style={{
                                    flexDirection: "row",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    marginBottom: 24,
                                }}
                            >
                                <Text style={{ color: colors.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>
                                    {isEditing ? t("repos.editRepoHeader", "Editar Repositorio") : t("repos.addRepoHeader", "Añadir Repositorio")}
                                </Text>
                                {/* Glass close button */}
                                <Pressable
                                    onPress={() => setModalVisible(false)}
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

                            {/* Tabs (only when adding, not editing) */}
                            {!isEditing && (
                                <View
                                    style={{
                                        flexDirection: "row",
                                        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
                                        borderRadius: 14,
                                        padding: 4,
                                        marginBottom: 20,
                                        borderWidth: 1,
                                        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                                    }}
                                >
                                    <Pressable
                                        onPress={() => setAddTab("manual")}
                                        style={{
                                            flex: 1,
                                            paddingVertical: 10,
                                            alignItems: "center",
                                            borderRadius: 10,
                                            backgroundColor: addTab === "manual"
                                                ? (isDark ? "rgba(255,255,255,0.12)" : "#FFFFFF")
                                                : "transparent",
                                            shadowColor: "#000",
                                            shadowOffset: { width: 0, height: 2 },
                                            shadowOpacity: addTab === "manual" ? 0.1 : 0,
                                            shadowRadius: 4,
                                        }}
                                    >
                                        <Text style={{
                                            color: colors.text,
                                            fontSize: 14,
                                            fontWeight: addTab === "manual" ? "700" : "500"
                                        }}>
                                            {t("repos.tabManual", "Manual")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => setAddTab("bulk")}
                                        style={{
                                            flex: 1,
                                            paddingVertical: 10,
                                            alignItems: "center",
                                            borderRadius: 10,
                                            backgroundColor: addTab === "bulk"
                                                ? (isDark ? "rgba(255,255,255,0.12)" : "#FFFFFF")
                                                : "transparent",
                                            shadowColor: "#000",
                                            shadowOffset: { width: 0, height: 2 },
                                            shadowOpacity: addTab === "bulk" ? 0.1 : 0,
                                            shadowRadius: 4,
                                        }}
                                    >
                                        <Text style={{
                                            color: colors.text,
                                            fontSize: 14,
                                            fontWeight: addTab === "bulk" ? "700" : "500"
                                        }}>
                                            {t("repos.tabBulk", "Importar Lote")}
                                        </Text>
                                    </Pressable>
                                </View>
                            )}

                            {isEditing || addTab === "manual" ? (
                                <View>
                                    {/* Campo: Nombre */}
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>
                                        {t("repos.repoNameLabel", "Nombre del repositorio")}
                                    </Text>
                                    <View
                                        style={{
                                            borderRadius: 14,
                                            overflow: "hidden",
                                            marginBottom: 16,
                                            borderWidth: 1,
                                            borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.70)",
                                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.45)",
                                        }}
                                    >
                                        <TextInput
                                            placeholder={t("repos.repoNamePlaceholder", "Ej: Mi Repositorio")}
                                            placeholderTextColor={isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.30)"}
                                            value={newRepoName}
                                            onChangeText={setNewRepoName}
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

                                    {/* Campo: URL */}
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>
                                        {t("repos.repoUrlLabel", "URL del repositorio (JSON)")}
                                    </Text>
                                    <View
                                        style={{
                                            borderRadius: 14,
                                            overflow: "hidden",
                                            marginBottom: 16,
                                            borderWidth: 1,
                                            borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.70)",
                                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.45)",
                                        }}
                                    >
                                        <TextInput
                                            placeholder={t("repos.urlPlaceholder", "https://ejemplo.com/repo.json")}
                                            placeholderTextColor={isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.30)"}
                                            value={newRepoUrl}
                                            onChangeText={setNewRepoUrl}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            keyboardType="url"
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

                                    {/* Selector de categoría */}
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                                        {t("repos.categoryLabel", "Categoría")}
                                    </Text>
                                    <View style={{ flexDirection: "row", gap: 10, marginBottom: 28 }}>
                                        {/* Sideload chip — liquid glass */}
                                        <Pressable
                                            onPress={() => setNewRepoCategory("sideload")}
                                            style={({ pressed }) => ({
                                                flex: 1,
                                                borderRadius: 16,
                                                overflow: "hidden",
                                                opacity: pressed ? 0.8 : 1,
                                                transform: [{ scale: pressed ? 0.97 : 1 }],
                                            })}
                                        >
                                            {newRepoCategory === "sideload" ? (
                                                <LinearGradient
                                                    colors={["#FF4D4D", "#FF1744", "#D50000"]}
                                                    start={{ x: 0, y: 0 }}
                                                    end={{ x: 1, y: 1 }}
                                                    style={{
                                                        padding: 14,
                                                        alignItems: "center",
                                                        borderRadius: 16,
                                                        borderWidth: 1,
                                                        borderColor: "rgba(255,255,255,0.20)",
                                                    }}
                                                >
                                                    <LinearGradient
                                                        colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0.05)", "transparent"]}
                                                        locations={[0, 0.3, 0.6]}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0, left: 0, right: 0, height: "50%",
                                                            borderTopLeftRadius: 16,
                                                            borderTopRightRadius: 16,
                                                        }}
                                                        pointerEvents="none"
                                                    />
                                                    <Text
                                                        style={{
                                                            color: "#FFFFFF",
                                                            fontWeight: "700",
                                                            fontSize: 14,
                                                            textShadowColor: "rgba(0,0,0,0.25)",
                                                            textShadowOffset: { width: 0, height: 1 },
                                                            textShadowRadius: 2,
                                                        }}
                                                    >
                                                        📦 Sideload
                                                    </Text>
                                                </LinearGradient>
                                            ) : (
                                                <BlurView
                                                    intensity={Platform.OS === "ios" ? 40 : 60}
                                                    tint={isDark ? "dark" : "light"}
                                                    style={{
                                                        padding: 14,
                                                        alignItems: "center",
                                                        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.35)",
                                                        borderRadius: 16,
                                                        borderWidth: 1,
                                                        borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.60)",
                                                    }}
                                                >
                                                    {/* Specular */}
                                                    <LinearGradient
                                                        colors={
                                                            isDark
                                                                ? ["rgba(255,255,255,0.10)", "transparent"]
                                                                : ["rgba(255,255,255,0.70)", "transparent"]
                                                        }
                                                        style={{
                                                            position: "absolute",
                                                            top: 0, left: 0, right: 0, height: "50%",
                                                            borderTopLeftRadius: 16,
                                                            borderTopRightRadius: 16,
                                                        }}
                                                        pointerEvents="none"
                                                    />
                                                    <Text
                                                        style={{
                                                            color: colors.text,
                                                            fontWeight: "700",
                                                            fontSize: 14,
                                                        }}
                                                    >
                                                        📦 Sideload
                                                    </Text>
                                                </BlurView>
                                            )}
                                        </Pressable>
                                        {/* Jailbreak chip — liquid glass */}
                                        <Pressable
                                            onPress={() => setNewRepoCategory("jailbreak")}
                                            style={({ pressed }) => ({
                                                flex: 1,
                                                borderRadius: 16,
                                                overflow: "hidden",
                                                opacity: pressed ? 0.8 : 1,
                                                transform: [{ scale: pressed ? 0.97 : 1 }],
                                            })}
                                        >
                                            {newRepoCategory === "jailbreak" ? (
                                                <LinearGradient
                                                    colors={["#FF4D4D", "#FF1744", "#D50000"]}
                                                    start={{ x: 0, y: 0 }}
                                                    end={{ x: 1, y: 1 }}
                                                    style={{
                                                        padding: 14,
                                                        alignItems: "center",
                                                        borderRadius: 16,
                                                        borderWidth: 1,
                                                        borderColor: "rgba(255,255,255,0.20)",
                                                    }}
                                                >
                                                    <LinearGradient
                                                        colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0.05)", "transparent"]}
                                                        locations={[0, 0.3, 0.6]}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0, left: 0, right: 0, height: "50%",
                                                            borderTopLeftRadius: 16,
                                                            borderTopRightRadius: 16,
                                                        }}
                                                        pointerEvents="none"
                                                    />
                                                    <Text
                                                        style={{
                                                            color: "#FFFFFF",
                                                            fontWeight: "700",
                                                            fontSize: 14,
                                                            textShadowColor: "rgba(0,0,0,0.25)",
                                                            textShadowOffset: { width: 0, height: 1 },
                                                            textShadowRadius: 2,
                                                        }}
                                                    >
                                                        🔓 Jailbreak
                                                    </Text>
                                                </LinearGradient>
                                            ) : (
                                                <BlurView
                                                    intensity={Platform.OS === "ios" ? 40 : 60}
                                                    tint={isDark ? "dark" : "light"}
                                                    style={{
                                                        padding: 14,
                                                        alignItems: "center",
                                                        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.35)",
                                                        borderRadius: 16,
                                                        borderWidth: 1,
                                                        borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.60)",
                                                    }}
                                                >
                                                    {/* Specular */}
                                                    <LinearGradient
                                                        colors={
                                                            isDark
                                                                ? ["rgba(255,255,255,0.10)", "transparent"]
                                                                : ["rgba(255,255,255,0.70)", "transparent"]
                                                        }
                                                        style={{
                                                            position: "absolute",
                                                            top: 0, left: 0, right: 0, height: "50%",
                                                            borderTopLeftRadius: 16,
                                                            borderTopRightRadius: 16,
                                                        }}
                                                        pointerEvents="none"
                                                    />
                                                    <Text
                                                        style={{
                                                            color: colors.text,
                                                            fontWeight: "700",
                                                            fontSize: 14,
                                                        }}
                                                    >
                                                        🔓 Jailbreak
                                                    </Text>
                                                </BlurView>
                                            )}
                                        </Pressable>
                                    </View>

                                    {/* Botón Guardar — gradient glass */}
                                    <Pressable
                                        onPress={handleSaveRepo}
                                        disabled={validating}
                                        style={({ pressed }) => ({
                                            borderRadius: 16,
                                            overflow: "hidden",
                                            opacity: pressed ? 0.85 : 1,
                                            transform: [{ scale: pressed ? 0.98 : 1 }],
                                        })}
                                    >
                                        <LinearGradient
                                            colors={
                                                validating
                                                    ? ["rgba(120,120,120,0.6)", "rgba(80,80,80,0.6)"]
                                                    : ["#FF4D4D", "#FF1744", "#D50000"]
                                            }
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                            style={{
                                                padding: 16,
                                                alignItems: "center",
                                                borderRadius: 16,
                                            }}
                                        >
                                            {/* Inner shine */}
                                            <LinearGradient
                                                colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0.05)", "transparent"]}
                                                locations={[0, 0.3, 0.6]}
                                                style={{
                                                    position: "absolute",
                                                    top: 0, left: 0, right: 0,
                                                    height: "50%",
                                                    borderTopLeftRadius: 16,
                                                    borderTopRightRadius: 16,
                                                }}
                                                pointerEvents="none"
                                            />
                                            {validating ? (
                                                <ActivityIndicator color="#FFFFFF" />
                                            ) : (
                                                <Text
                                                    style={{
                                                        color: "#FFFFFF",
                                                        fontSize: 16,
                                                        fontWeight: "700",
                                                        letterSpacing: 0.3,
                                                        textShadowColor: "rgba(0,0,0,0.25)",
                                                        textShadowOffset: { width: 0, height: 1 },
                                                        textShadowRadius: 2,
                                                    }}
                                                >
                                                    {isEditing ? t("repos.saveEditBtn", "💾 Guardar Cambios") : t("repos.saveBtn", "✨ Validar y Añadir")}
                                                </Text>
                                            )}
                                        </LinearGradient>
                                    </Pressable>
                                </View>
                            ) : (
                                <View>
                                    {/* Campo: Pegar URLs de Repositorios */}
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>
                                        {t("repos.bulkUrlsLabel", "Pegar URLs o JSON")}
                                    </Text>
                                    <View
                                        style={{
                                            borderRadius: 14,
                                            overflow: "hidden",
                                            marginBottom: 12,
                                            borderWidth: 1,
                                            borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.70)",
                                            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.45)",
                                            height: 120,
                                        }}
                                    >
                                        <TextInput
                                            placeholder={t("repos.bulkPlaceholder", "Pega una URL por línea o un array de URLs JSON. Ej:\nhttps://example.com/repo1.json\nhttps://example.com/repo2.json")}
                                            placeholderTextColor={isDark ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.30)"}
                                            value={bulkText}
                                            onChangeText={setBulkText}
                                            multiline
                                            numberOfLines={5}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            style={{
                                                color: colors.text,
                                                fontSize: 14,
                                                padding: 12,
                                                paddingHorizontal: 16,
                                                height: "100%",
                                                textAlignVertical: "top",
                                                // @ts-ignore
                                                outlineStyle: "none" as any,
                                            }}
                                        />
                                    </View>

                                    {/* Botón para subir archivo */}
                                    <Pressable
                                        onPress={handlePickRepoFile}
                                        style={({ pressed }) => ({
                                            flexDirection: "row",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 8,
                                            paddingVertical: 12,
                                            borderRadius: 14,
                                            borderWidth: 1,
                                            borderStyle: "dashed",
                                            borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)",
                                            backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                                            marginBottom: 16,
                                            opacity: pressed ? 0.7 : 1,
                                        })}
                                    >
                                        <Ionicons name="document-attach" size={18} color={colors.accent} />
                                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                                            {t("repos.uploadFileBtn", "Subir Archivo (.txt / .json)")}
                                        </Text>
                                    </Pressable>

                                    {/* Selector de categoría */}
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                                        {t("repos.categoryLabelBulk", "Categoría para el lote")}
                                    </Text>
                                    <View style={{ flexDirection: "row", gap: 10, marginBottom: 28 }}>
                                        {/* Sideload chip — liquid glass */}
                                        <Pressable
                                            onPress={() => setBulkCategory("sideload")}
                                            style={({ pressed }) => ({
                                                flex: 1,
                                                borderRadius: 16,
                                                overflow: "hidden",
                                                opacity: pressed ? 0.8 : 1,
                                                transform: [{ scale: pressed ? 0.97 : 1 }],
                                            })}
                                        >
                                            {bulkCategory === "sideload" ? (
                                                <LinearGradient
                                                    colors={["#FF4D4D", "#FF1744", "#D50000"]}
                                                    start={{ x: 0, y: 0 }}
                                                    end={{ x: 1, y: 1 }}
                                                    style={{
                                                        padding: 14,
                                                        alignItems: "center",
                                                        borderRadius: 16,
                                                        borderWidth: 1,
                                                        borderColor: "rgba(255,255,255,0.20)",
                                                    }}
                                                >
                                                    <LinearGradient
                                                        colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0.05)", "transparent"]}
                                                        locations={[0, 0.3, 0.6]}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0, left: 0, right: 0, height: "50%",
                                                            borderTopLeftRadius: 16,
                                                            borderTopRightRadius: 16,
                                                        }}
                                                        pointerEvents="none"
                                                    />
                                                    <Text
                                                        style={{
                                                            color: "#FFFFFF",
                                                            fontWeight: "700",
                                                            fontSize: 14,
                                                            textShadowColor: "rgba(0,0,0,0.25)",
                                                            textShadowOffset: { width: 0, height: 1 },
                                                            textShadowRadius: 2,
                                                        }}
                                                    >
                                                        📦 Sideload
                                                    </Text>
                                                </LinearGradient>
                                            ) : (
                                                <BlurView
                                                    intensity={Platform.OS === "ios" ? 40 : 60}
                                                    tint={isDark ? "dark" : "light"}
                                                    style={{
                                                        padding: 14,
                                                        alignItems: "center",
                                                        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.35)",
                                                        borderRadius: 16,
                                                        borderWidth: 1,
                                                        borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.60)",
                                                    }}
                                                >
                                                    {/* Specular */}
                                                    <LinearGradient
                                                        colors={
                                                            isDark
                                                                ? ["rgba(255,255,255,0.10)", "transparent"]
                                                                : ["rgba(255,255,255,0.70)", "transparent"]
                                                        }
                                                        style={{
                                                            position: "absolute",
                                                            top: 0, left: 0, right: 0, height: "50%",
                                                            borderTopLeftRadius: 16,
                                                            borderTopRightRadius: 16,
                                                        }}
                                                        pointerEvents="none"
                                                    />
                                                    <Text
                                                        style={{
                                                            color: colors.text,
                                                            fontWeight: "700",
                                                            fontSize: 14,
                                                        }}
                                                    >
                                                        📦 Sideload
                                                    </Text>
                                                </BlurView>
                                            )}
                                        </Pressable>
                                        {/* Jailbreak chip — liquid glass */}
                                        <Pressable
                                            onPress={() => setBulkCategory("jailbreak")}
                                            style={({ pressed }) => ({
                                                flex: 1,
                                                borderRadius: 16,
                                                overflow: "hidden",
                                                opacity: pressed ? 0.8 : 1,
                                                transform: [{ scale: pressed ? 0.97 : 1 }],
                                            })}
                                        >
                                            {bulkCategory === "jailbreak" ? (
                                                <LinearGradient
                                                    colors={["#FF4D4D", "#FF1744", "#D50000"]}
                                                    start={{ x: 0, y: 0 }}
                                                    end={{ x: 1, y: 1 }}
                                                    style={{
                                                        padding: 14,
                                                        alignItems: "center",
                                                        borderRadius: 16,
                                                        borderWidth: 1,
                                                        borderColor: "rgba(255,255,255,0.20)",
                                                    }}
                                                >
                                                    <LinearGradient
                                                        colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0.05)", "transparent"]}
                                                        locations={[0, 0.3, 0.6]}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0, left: 0, right: 0, height: "50%",
                                                            borderTopLeftRadius: 16,
                                                            borderTopRightRadius: 16,
                                                        }}
                                                        pointerEvents="none"
                                                    />
                                                    <Text
                                                        style={{
                                                            color: "#FFFFFF",
                                                            fontWeight: "700",
                                                            fontSize: 14,
                                                            textShadowColor: "rgba(0,0,0,0.25)",
                                                            textShadowOffset: { width: 0, height: 1 },
                                                            textShadowRadius: 2,
                                                        }}
                                                    >
                                                        🔓 Jailbreak
                                                    </Text>
                                                </LinearGradient>
                                            ) : (
                                                <BlurView
                                                    intensity={Platform.OS === "ios" ? 40 : 60}
                                                    tint={isDark ? "dark" : "light"}
                                                    style={{
                                                        padding: 14,
                                                        alignItems: "center",
                                                        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.35)",
                                                        borderRadius: 16,
                                                        borderWidth: 1,
                                                        borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.60)",
                                                    }}
                                                >
                                                    {/* Specular */}
                                                    <LinearGradient
                                                        colors={
                                                            isDark
                                                                ? ["rgba(255,255,255,0.10)", "transparent"]
                                                                : ["rgba(255,255,255,0.70)", "transparent"]
                                                        }
                                                        style={{
                                                            position: "absolute",
                                                            top: 0, left: 0, right: 0, height: "50%",
                                                            borderTopLeftRadius: 16,
                                                            borderTopRightRadius: 16,
                                                        }}
                                                        pointerEvents="none"
                                                    />
                                                    <Text
                                                        style={{
                                                            color: colors.text,
                                                            fontWeight: "700",
                                                            fontSize: 14,
                                                        }}
                                                    >
                                                        🔓 Jailbreak
                                                    </Text>
                                                </BlurView>
                                            )}
                                        </Pressable>
                                    </View>

                                    {/* Botón Importar Lote — gradient glass */}
                                    <Pressable
                                        onPress={handleBulkImport}
                                        disabled={importingBulk}
                                        style={({ pressed }) => ({
                                            borderRadius: 16,
                                            overflow: "hidden",
                                            opacity: pressed ? 0.85 : 1,
                                            transform: [{ scale: pressed ? 0.98 : 1 }],
                                        })}
                                    >
                                        <LinearGradient
                                            colors={
                                                importingBulk
                                                    ? ["rgba(120,120,120,0.6)", "rgba(80,80,80,0.6)"]
                                                    : ["#FF4D4D", "#FF1744", "#D50000"]
                                            }
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                            style={{
                                                padding: 16,
                                                alignItems: "center",
                                                borderRadius: 16,
                                            }}
                                        >
                                            {/* Inner shine */}
                                            <LinearGradient
                                                colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0.05)", "transparent"]}
                                                locations={[0, 0.3, 0.6]}
                                                style={{
                                                    position: "absolute",
                                                    top: 0, left: 0, right: 0,
                                                    height: "50%",
                                                    borderTopLeftRadius: 16,
                                                    borderTopRightRadius: 16,
                                                }}
                                                pointerEvents="none"
                                            />
                                            {importingBulk ? (
                                                <ActivityIndicator color="#FFFFFF" />
                                            ) : (
                                                <Text
                                                    style={{
                                                        color: "#FFFFFF",
                                                        fontSize: 16,
                                                        fontWeight: "700",
                                                        letterSpacing: 0.3,
                                                        textShadowColor: "rgba(0,0,0,0.25)",
                                                        textShadowOffset: { width: 0, height: 1 },
                                                        textShadowRadius: 2,
                                                    }}
                                                >
                                                    {t("repos.bulkImportBtn", "⚡ Importar Lote")}
                                                </Text>
                                            )}
                                        </LinearGradient>
                                    </Pressable>
                                </View>
                            )}
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View >
    );
}
