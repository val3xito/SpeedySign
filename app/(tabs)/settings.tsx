/**
 * settings.tsx - Pantalla de Ajustes
 * Permite al usuario cambiar el tema (oscuro/claro),
 * restaurar repos por defecto, ver la versión de la app
 * y leer información "Acerca de".
 */

import React from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Switch,
    Pressable,
    Image,
    Modal,
    TouchableOpacity,
    Platform,
    Linking
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { CustomSwitch } from "../../components/CustomSwitch";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import { useRepos } from "../../hooks/useRepos";
import { useHeaderHeight } from '@react-navigation/elements';
import { notify } from "../../utils/notify";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from "react-i18next";
import { exportAllRepos, parseRepoBackup, downloadRepoBackupWeb } from "../../utils/repoExporter";

/**
 * Pantalla de ajustes con opciones de personalización.
 */
export default function SettingsScreen() {
    const { colors, isDark, toggleTheme } = useTheme();
    const { resetDefaults, repos, addRepo } = useRepos();
    const router = useRouter();
    const headerHeight = useHeaderHeight();
    const { t, i18n } = useTranslation();
    const [isLangModalVisible, setLangModalVisible] = React.useState(false);
    const [isTermsModalVisible, setTermsModalVisible] = React.useState(false);

    const LANGUAGES = [
        { code: 'es', name: 'Español', flag: '🇪🇸' },
        { code: 'en', name: 'English', flag: '🇺🇸' }
    ];

    const handleLanguageSelect = async (code: string) => {
        await AsyncStorage.setItem('app_language', code);
        i18n.changeLanguage(code);
        setLangModalVisible(false);
    };

    const getActiveLanguageName = () => {
        const lang = LANGUAGES.find(l => l.code === (i18n.language || 'en').split('-')[0]);
        return lang ? lang.name : 'English';
    };

    /** Exporta los repos custom como JSON y lo descarga en web. */
    const handleExportRepos = () => {
        try {
            const json = exportAllRepos(repos);
            const parsed = JSON.parse(json);
            if (parsed.repos.length === 0) {
                notify.error(t("settings.exportEmpty", "Sin repos"), t("settings.exportEmptyMsg", "No hay repositorios para exportar."));
                return;
            }
            if (typeof document !== "undefined") {
                downloadRepoBackupWeb(json);
                notify.success(t("settings.done", "¡Listo!"), t("settings.exportSuccess", `${parsed.repos.length} repositorios exportados.`));
            }
        } catch {
            notify.error(t("common.error", "Error"), t("settings.exportError", "No se pudo exportar."));
        }
    };

    /** Importa repos desde un archivo JSON seleccionado por el usuario. */
    const handleImportRepos = () => {
        if (typeof document === "undefined") return;
        const input = document.createElement("input");
        input.type   = "file";
        input.accept = ".json,application/json";
        input.onchange = async (e: any) => {
            const file = e.target?.files?.[0];
            if (!file) return;

            // Límite de tamaño de archivo (1 MB) para evitar sobrecargas de memoria
            const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
            if (file.size && file.size > MAX_FILE_SIZE) {
                notify.error(t("common.error", "Error"), t("settings.importErrorTooLarge", "El archivo es demasiado grande. El límite es 1 MB."));
                return;
            }

            try {
                const text   = await file.text();
                const parsed = parseRepoBackup(text);
                if (!parsed || parsed.length === 0) {
                    notify.error(t("common.error", "Error"), t("settings.importInvalid", "Archivo de backup inválido o sin repositorios."));
                    return;
                }
                let added = 0;
                for (const r of parsed) {
                    const exists = repos.some((existing) => existing.url === r.url);
                    if (!exists) {
                        await addRepo({ ...r, enabled: true });
                        added++;
                    }
                }
                notify.success(t("settings.done", "¡Listo!"), t("settings.importSuccess", "{{added}} repositorios importados ({{skipped}} ya existían).", { added, skipped: parsed.length - added }));
            } catch {
                notify.error(t("common.error", "Error"), t("settings.importError", "No se pudo importar el archivo."));
            }
        };
        input.click();
    };

    /**
     * Confirma y restaura los repositorios por defecto.
     */
    const handleResetRepos = () => {
        notify.confirm(
            t("settings.restoreConfirmTitle", "Restaurar repositorios"),
            t("settings.restoreConfirmMsg", "¿Estás seguro? Esto eliminará todos los repositorios añadidos manualmente y restaurará los predeterminados."),
            async () => {
                await resetDefaults();
                notify.success(t("settings.done", "¡Listo!"), t("settings.restoreSuccess", "Repositorios restaurados correctamente."));
            },
            undefined, // onCancel param
            'refresh-outline'
        );
    };

    /**
     * Componente auxiliar para un item de ajuste.
     */
    const SettingItem = ({
        icon,
        title,
        subtitle,
        right,
        onPress,
        index = 0,
    }: {
        icon: string;
        title: string;
        subtitle?: string;
        right?: React.ReactNode;
        onPress?: () => void;
        index?: number;
    }) => (
        <Animated.View entering={FadeInDown.delay(index * 80).duration(300)}>
            <Pressable
                onPress={onPress}
                disabled={!onPress}
                style={({ pressed }) => ({
                    backgroundColor: colors.card,
                    borderRadius: 16,
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    opacity: pressed && onPress ? 0.75 : 1,
                })}
            >
                {/* Icono */}
                <View
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: `${colors.accent}20`,
                        justifyContent: "center",
                        alignItems: "center",
                    }}
                >
                    <Ionicons name={icon as any} size={20} color={colors.accent} />
                </View>

                {/* Texto */}
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text
                        style={{
                            color: colors.text,
                            fontSize: 15,
                            fontWeight: "600",
                        }}
                    >
                        {title}
                    </Text>
                    {subtitle && (
                        <Text
                            style={{
                                color: colors.textSecondary,
                                fontSize: 13,
                                marginTop: 2,
                            }}
                        >
                            {subtitle}
                        </Text>
                    )}
                </View>

                {/* Contenido derecho (toggle, chevron, etc.) */}
                {right}
            </Pressable>
        </Animated.View>
    );

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: colors.background }}
            contentContainerStyle={{ padding: 16, paddingTop: headerHeight + 20, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
        >
            {/* Tarjeta de Donaciones Ko-fi */}
            <Animated.View
                entering={FadeInDown.delay(100).duration(300)}
                style={{
                    borderRadius: 16,
                    marginBottom: 24,
                    overflow: 'hidden',
                }}
            >
                <LinearGradient
                    colors={isDark ? ['#2a1616', '#1a0d0d'] : ['#ffeff0', '#ffe0e2']}
                    style={{ padding: 20, borderWidth: 1, borderColor: isDark ? '#3a1e1e' : '#ffcdd2', borderRadius: 16 }}
                >
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                        <Ionicons name="cafe-outline" size={24} color={isDark ? "#ff5252" : "#c62828"} style={{ marginRight: 10 }} />
                        <Text style={{ fontSize: 18, fontWeight: '700', color: isDark ? "#fff" : "#b71c1c", letterSpacing: -0.3 }}>
                            {t("settings.supportTitle", "Apoya el Proyecto")}
                        </Text>
                    </View>
                    <Text style={{ fontSize: 14, color: isDark ? "#ffb3b3" : "#c62828", lineHeight: 22, marginBottom: 16 }}>
                        {t("settings.supportDesc", "Ayúdame a mantener los servidores activos y veloces. ¡Cualquier apoyo en Ko-fi es súper bienvenido! ☕")}
                    </Text>
                    <Pressable
                        onPress={() => Linking.openURL('https://ko-fi.com/val3xito')}
                        style={({ pressed }) => ({
                            backgroundColor: pressed ? (isDark ? "#d32f2f" : "#b71c1c") : (isDark ? "#ff3b30" : "#d32f2f"),
                            paddingVertical: 12,
                            borderRadius: 12,
                            alignItems: 'center',
                            flexDirection: 'row',
                            justifyContent: 'center',
                        })}
                    >
                        <Text style={{ color: "#fff", fontSize: 15, fontWeight: '700', marginRight: 8 }}>
                            {t("settings.supportButton", "Invítame a un café en Ko-fi")}
                        </Text>
                        <Ionicons name="heart" size={16} color="#fff" />
                    </Pressable>
                </LinearGradient>
            </Animated.View>

            <View style={{ flexDirection: "row", gap: 12, marginBottom: 12, alignItems: "stretch" }}>
                {/* Telegram */}
                <Animated.View entering={FadeInDown.delay(80).duration(300)} style={{ flex: 1 }}>
                    <Pressable
                        onPress={() => Linking.openURL('https://t.me/speedysign')}
                        style={({ pressed }) => ({
                            backgroundColor: colors.card,
                            borderRadius: 16,
                            padding: 16,
                            borderWidth: 1,
                            borderColor: colors.cardBorder,
                            opacity: pressed ? 0.75 : 1,
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            flex: 1,
                        })}
                    >
                        <View
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 12,
                                backgroundColor: `${colors.accent}20`,
                                justifyContent: "center",
                                alignItems: "center",
                                marginBottom: 4,
                            }}
                        >
                            <Ionicons name="paper-plane-outline" size={22} color={colors.accent} />
                        </View>
                        <View style={{ marginTop: 8, width: "100%", alignItems: "center" }}>
                            <Text
                                style={{
                                    color: colors.text,
                                    fontSize: 14,
                                    fontWeight: "600",
                                    textAlign: "center",
                                }}
                            >
                                {t("settings.telegramTitle", "Comunidad en Telegram")}
                            </Text>
                            <Text
                                style={{
                                    color: colors.textSecondary,
                                    fontSize: 11,
                                    marginTop: 4,
                                    lineHeight: 14,
                                    textAlign: "center",
                                }}
                                numberOfLines={2}
                            >
                                {t("settings.telegramDescShort", "Descarga repositorios (.json) y entérate de novedades.")}
                            </Text>
                        </View>
                    </Pressable>
                </Animated.View>

                {/* Reddit */}
                <Animated.View entering={FadeInDown.delay(160).duration(300)} style={{ flex: 1 }}>
                    <Pressable
                        onPress={() => Linking.openURL('https://www.reddit.com/r/SpeedySign/')}
                        style={({ pressed }) => ({
                            backgroundColor: colors.card,
                            borderRadius: 16,
                            padding: 16,
                            borderWidth: 1,
                            borderColor: colors.cardBorder,
                            opacity: pressed ? 0.75 : 1,
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            flex: 1,
                        })}
                    >
                        <View
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 12,
                                backgroundColor: `${colors.accent}20`,
                                justifyContent: "center",
                                alignItems: "center",
                                marginBottom: 4,
                            }}
                        >
                            <Ionicons name="logo-reddit" size={22} color={colors.accent} />
                        </View>
                        <View style={{ marginTop: 8, width: "100%", alignItems: "center" }}>
                            <Text
                                style={{
                                    color: colors.text,
                                    fontSize: 14,
                                    fontWeight: "600",
                                    textAlign: "center",
                                }}
                            >
                                {t("settings.redditTitle", "Comunidad en Reddit")}
                            </Text>
                            <Text
                                style={{
                                    color: colors.textSecondary,
                                    fontSize: 11,
                                    marginTop: 4,
                                    lineHeight: 14,
                                    textAlign: "center",
                                }}
                                numberOfLines={2}
                            >
                                {t("settings.redditDescShort", "Visita nuestra comunidad oficial r/SpeedySign en Reddit.")}
                            </Text>
                        </View>
                    </Pressable>
                </Animated.View>
            </View>

            {/* Sección: Apariencia */}
            <Text
                style={{
                    color: colors.textSecondary,
                    fontSize: 13,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    marginBottom: 10,
                    marginTop: 4,
                }}
            >
                {t("settings.section.appearance", "Apariencia")}
            </Text>

            <SettingItem
                icon="moon-outline"
                title={t("settings.darkMode", "Tema oscuro")}
                subtitle={isDark ? t("settings.darkModeOn", "Activado") : t("settings.darkModeOff", "Desactivado")}
                index={0}
                right={
                    <CustomSwitch
                        value={isDark}
                        onValueChange={toggleTheme}
                    />
                }
            />

            <SettingItem
                icon="globe-outline"
                title={t("settings.language", "Idioma")}
                subtitle={getActiveLanguageName()}
                index={1}
                onPress={() => setLangModalVisible(true)}
                right={
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                }
            />

            {/* Sección: Certificados */}
            <Text
                style={{
                    color: colors.textSecondary,
                    fontSize: 13,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    marginBottom: 10,
                    marginTop: 20,
                }}
            >
                {t("settings.section.certificates", "Certificados")}
            </Text>

            <SettingItem
                icon="shield-checkmark-outline"
                title={t("settings.manageCerts", "Gestión de Certificados")}
                subtitle={t("settings.manageCertsSub", "Importar o cambiar certificado activo")}
                onPress={() => router.push("/certificates")}
                index={1}
                right={
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                }
            />

            {/* Sección: Repositorios */}
            <Text
                style={{
                    color: colors.textSecondary,
                    fontSize: 13,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    marginBottom: 10,
                    marginTop: 20,
                }}
            >
                {t("settings.section.repositories", "Repositorios")}
            </Text>

            <SettingItem
                icon="cube-outline"
                title={t("settings.repos", "Repositorios")}
                subtitle={t("settings.reposSub", "Gestionar fuentes de apps")}
                onPress={() => router.push("/repositories")}
                index={2}
                right={
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                }
            />

            <SettingItem
                icon="download-outline"
                title={t("settings.exportRepos", "Exportar repositorios")}
                subtitle={t("settings.exportReposSub", "Guardar todos los repositorios como JSON")}
                onPress={handleExportRepos}
                index={3}
                right={
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                }
            />

            <SettingItem
                icon="push-outline"
                title={t("settings.importRepos", "Importar repositorios")}
                subtitle={t("settings.importReposSub", "Cargar repos desde un archivo JSON")}
                onPress={handleImportRepos}
                index={4}
                right={
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                }
            />

            <SettingItem
                icon="refresh-outline"
                title={t("settings.restoreRepos", "Restaurar repositorios")}
                subtitle={t("settings.restoreReposSub", "Restaurar a los repos por defecto")}
                onPress={handleResetRepos}
                index={5}
                right={
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                }
            />

            {/* Sección: Acerca de */}
            <Text
                style={{
                    color: colors.textSecondary,
                    fontSize: 13,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    marginBottom: 10,
                    marginTop: 20,
                }}
            >
                {t("settings.section.about", "Acerca de")}
            </Text>

            <SettingItem
                icon="document-text-outline"
                title={t("settings.terms", "Términos y Aviso Legal")}
                subtitle={t("settings.termsSub", "Leer descargo de responsabilidad")}
                index={4}
                onPress={() => setTermsModalVisible(true)}
                right={<Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />}
            />

            <SettingItem
                icon="bug-outline"
                title={t("settings.bugs", "Bugs")}
                subtitle={t("settings.bugsSub", "Reportar errores en Telegram")}
                index={5}
                onPress={() => Linking.openURL('https://t.me/+3sdH1Ta5JZ03ZTdk')}
                right={<Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />}
            />

            {/* Descripción de la app */}
            <Animated.View
                entering={FadeInDown.delay(400).duration(300)}
                style={{
                    backgroundColor: colors.card,
                    borderRadius: 16,
                    padding: 20,
                    marginTop: 8,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                }}
            >
                <View style={{ alignItems: "center", marginBottom: 20 }}>
                    <Image
                        source={require("../../assets/logo-transparent.png")}
                        style={{ width: 70, height: 70, borderRadius: 20, marginBottom: 12 }}
                    />
                    <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text, letterSpacing: -0.3 }}>
                        SpeedySign
                    </Text>
                </View>

                {/* Info Text */}
                <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 22, textAlign: "center" }}>
                    {t("settings.aboutApp", "Firma IPAS rápido y fácil con SpeedySign.")}
                </Text>
            </Animated.View>

            {/* Modal de Idiomas */}
            <Modal visible={isLangModalVisible} animationType="slide" transparent={true}>
                <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "transparent" }}>
                    {/* Tap-outside to close */}
                    <Pressable style={{ flex: 1 }} onPress={() => setLangModalVisible(false)} />
                    <View style={{
                        borderTopLeftRadius: 28,
                        borderTopRightRadius: 28,
                        maxHeight: '80%',
                        overflow: 'hidden',
                        width: '100%',
                    }}>
                        {/* Frosted glass background */}
                        <BlurView
                            intensity={Platform.OS === 'ios' ? 80 : 100}
                            tint={isDark ? 'dark' : 'light'}
                            style={{
                                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                backgroundColor: isDark ? 'rgba(18,18,22,0.92)' : 'rgba(245,245,250,0.88)',
                            }}
                        />

                        {/* Specular highlight */}
                        <LinearGradient
                            colors={
                                isDark
                                    ? ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.03)', 'transparent']
                                    : ['rgba(255,255,255,0.90)', 'rgba(255,255,255,0.35)', 'transparent']
                            }
                            locations={[0, 0.25, 0.6]}
                            style={{
                                position: 'absolute', top: 0, left: 0, right: 0, height: 100,
                                borderTopLeftRadius: 28, borderTopRightRadius: 28,
                            }}
                            pointerEvents="none"
                        />
                        {/* Top hairline */}
                        <View style={{
                            position: 'absolute', top: 0, left: 0, right: 0, height: 1.5,
                            backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                            borderTopLeftRadius: 28, borderTopRightRadius: 28,
                        }} pointerEvents="none" />

                        <View style={{ padding: 24, paddingTop: 14 }}>
                            {/* Drag handle */}
                            <View style={{ alignItems: 'center', marginBottom: 16 }}>
                                <View style={{
                                    width: 40, height: 5, borderRadius: 3,
                                    backgroundColor: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)',
                                }} />
                            </View>

                            {/* Header */}
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, letterSpacing: -0.3 }}>
                                    {t("settings.languageModalTitle", "Seleccionar Idioma")}
                                </Text>
                                {/* Glass close button */}
                                <Pressable
                                    onPress={() => setLangModalVisible(false)}
                                    style={{
                                        width: 32, height: 32, borderRadius: 16,
                                        backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                                        borderWidth: 1,
                                        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.70)',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                                </Pressable>
                            </View>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: 24 }}>
                            {LANGUAGES.map((lang, index) => (
                                <TouchableOpacity
                                    key={lang.code}
                                    onPress={() => handleLanguageSelect(lang.code)}
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        paddingVertical: 15,
                                        borderBottomWidth: index < LANGUAGES.length - 1 ? 1 : 0,
                                        borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : colors.cardBorder,
                                    }}
                                >
                                    <Text style={{ fontSize: 24, marginRight: 15 }}>{lang.flag}</Text>
                                    <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>{lang.name}</Text>
                                    {(i18n.language || 'en').split('-')[0] === lang.code && (
                                        <Ionicons name="checkmark" size={22} color={colors.accent} />
                                    )}
                                </TouchableOpacity>
                            ))}
                            <View style={{ height: 24 }} />
                        </ScrollView>
                    </View>
                </View>
            </Modal>
            {/* Modal de Términos */}
            <Modal visible={isTermsModalVisible} animationType="slide" transparent={true}>
                <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "transparent" }}>
                    <Pressable style={{ flex: 1 }} onPress={() => setTermsModalVisible(false)} />
                    <View style={{
                        borderTopLeftRadius: 28,
                        borderTopRightRadius: 28,
                        maxHeight: '85%',
                        overflow: 'hidden',
                        width: '100%',
                    }}>
                        <BlurView intensity={Platform.OS === 'ios' ? 80 : 100} tint={isDark ? 'dark' : 'light'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: isDark ? 'rgba(18,18,22,0.92)' : 'rgba(245,245,250,0.88)' }} />
                        <LinearGradient colors={isDark ? ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.03)', 'transparent'] : ['rgba(255,255,255,0.90)', 'rgba(255,255,255,0.35)', 'transparent']} locations={[0, 0.25, 0.6]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 100, borderTopLeftRadius: 28, borderTopRightRadius: 28 }} pointerEvents="none" />
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1.5, backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', borderTopLeftRadius: 28, borderTopRightRadius: 28 }} pointerEvents="none" />

                        <View style={{ padding: 24, paddingTop: 14 }}>
                            <View style={{ alignItems: 'center', marginBottom: 16 }}>
                                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)' }} />
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, letterSpacing: -0.3 }}>
                                    {t("settings.termsTitle", "Términos y Aviso Legal")}
                                </Text>
                                <Pressable
                                    onPress={() => setTermsModalVisible(false)}
                                    style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)', borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.70)', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                                </Pressable>
                            </View>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: 24, marginBottom: 40 }}>
                            <Text style={{ color: colors.text, fontSize: 15, lineHeight: 24, marginBottom: 15, fontWeight: '600' }}>
                                {t("settings.termsDesc1", "SpeedySign es una herramienta de desarrollo educativo diseñada para la firma de aplicaciones (archivos .ipa) y pruebas en entornos propios de iOS.")}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 15 }}>
                                {t("settings.termsDesc2", "1. Los administradores de SpeedySign no proveen, almacenan, ni distribuyen archivos con derechos de autor (.ipa, juegos, o apps de pago modificadas). El usuario es el único responsable del origen y la legalidad de los repositorios y archivos que introduce en la plataforma.")}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 15 }}>
                                {t("settings.termsDesc3", "2. Todos los archivos procesados por esta plataforma se eliminan automáticamente del servidor en 5 minutos o menos. No mantenemos registros persistentes de los archivos subidos.")}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 15 }}>
                                {t("settings.termsDesc4", "3. El uso indebido de certificados de desarrollador puede resultar en su revocación inmediata por parte del proveedor correspondiente (Apple). SpeedySign no se hace responsable de la pérdida de dichos certificados.")}
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 15 }}>
                                {t("settings.termsDesc5", "Al utilizar esta herramienta, confirmas que posees los derechos legales sobre los archivos que estás manipulando y eximes a los creadores de la plataforma de cualquier responsabilidad legal derivada de tu uso.")}
                            </Text>
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}
