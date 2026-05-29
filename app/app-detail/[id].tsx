/**
 * app-detail/[id].tsx - Pantalla de detalle de app + firma
 * Muestra la información completa de una aplicación y permite
 * iniciar el proceso de descarga, firma e instalación real.
 */

import React, { useState, useCallback } from "react";
import {
    View,
    Text,
    ScrollView,
    Image,
    Pressable,
    ActivityIndicator,
    Platform,
    Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, Stack } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "../../hooks/useTheme";
import { useCertificates } from "../../hooks/useCertificates";
import { useInstalledApps } from "../../hooks/useInstalledApps";
import { IpaCustomizer, IpaCustomOptions, defaultIpaOptions } from "../../components/IpaCustomizer";
import { ProgressBar } from "../../components/ProgressBar";
import {
    SigningLog,
    SigningStep,
    getInitialSigningSteps,
} from "../../components/SigningLog";
import {
    installIPA,
    signIPAWithBackend,
    deleteSignedIPA,
    cancelSigningJob,
    SigningResult,
    SigningProgressEvent,
} from "../../utils/ipaDownloader";
import { notify } from "../../utils/notify";
import { useTranslation } from "react-i18next";
import { useSigningContext } from "../../contexts/SigningContext";
import { getImgProxyUrl } from "../../utils/imgProxy";

/**
 * Pantalla de detalle de app con proceso de firma.
 * Recibe los datos de la app como parámetros de navegación.
 */
export default function AppDetailScreen() {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const params = useLocalSearchParams<{
        id: string;
        name: string;
        version: string;
        icon: string;
        description: string;
        downloadURL: string;
        size: string;
        repoName: string;
        category?: string;
    }>();

    const { hasValidCertificate, getActiveCertificate } = useCertificates();
    const { saveInstallation } = useInstalledApps();

    // Estado global de firma (persiste al navegar fuera de esta pantalla)
    const { signingState, setSigningState, cancelRef, abortControllerRef } = useSigningContext();

    const isIOS = Platform.OS === 'ios' || 
        (Platform.OS === 'web' && typeof navigator !== 'undefined' && (
            /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        ));

    // Solo mostrar el progreso si nombre + versión + repo coinciden con esta app concreta
    const isThisApp =
        signingState.appUrl     === (params.downloadURL || "") &&
        signingState.appVersion === (params.version     || "") &&
        signingState.appRepoName === (params.repoName   || "");
    const isSigning      = isThisApp ? signingState.isSigning      : false;
    const signingComplete = isThisApp ? signingState.signingComplete : false;
    const signingError   = isThisApp ? signingState.signingError   : null;
    const progress       = isThisApp ? signingState.progress       : 0;
    const steps          = isThisApp ? signingState.steps          : getInitialSigningSteps();

    // Helpers locales que escriben en el contexto global
    const setIsSigning      = (v: boolean)        => setSigningState(p => ({ ...p, isSigning: v }));
    const setSigningComplete = (v: boolean)       => setSigningState(p => ({ ...p, signingComplete: v }));
    const setSigningError   = (v: string | null)  => setSigningState(p => ({ ...p, signingError: v }));
    const setProgress       = (v: number)         => setSigningState(p => ({ ...p, progress: v }));
    const setSteps          = (updater: SigningStep[] | ((prev: SigningStep[]) => SigningStep[])) =>
        setSigningState(p => ({
            ...p,
            steps: typeof updater === "function" ? updater(p.steps) : updater,
        }));

    const [signerPreference, setSignerPreference] = useState<"auto" | "zsign" | "arksign" | "speedysigner">("auto");
    // Opciones de personalización pre-firma
    const [ipaOptions, setIpaOptions] = useState<IpaCustomOptions>(defaultIpaOptions());

    React.useEffect(() => {
        AsyncStorage.getItem('signer_pref').then((val) => {
            if (val === "speedysigner") {
                AsyncStorage.setItem('signer_pref', "auto");
                setSignerPreference("auto");
            } else if (val === "auto" || val === "zsign" || val === "arksign") {
                setSignerPreference(val as any);
            }
        });
    }, []);

    // Estado de traducción
    const [translatedDesc, setTranslatedDesc] = useState<string | null>(null);
    const [isTranslating, setIsTranslating] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);


    /**
     * Proceso completo de descarga real, validación, firma e instalación.
     * La descarga usa expo-file-system con progreso real en bytes.
     */
    const startSigningProcess = useCallback(async () => {
        // Verificar si YA hay una instalación en curso para OTRA app
        if (signingState.isSigning && !isThisApp) {
            notify.error(
                t("common.error", "Error"),
                t("appDetail.alreadySigning", "Ya hay una aplicación instalándose en segundo plano. Espera a que termine o cancela la actual.")
            );
            return;
        }

        // Verificar certificado
        if (!hasValidCertificate) {
            notify.error(
                t("appDetail.errorNoCert", "Sin certificado"),
                t("appDetail.errorNoCertDesc", "No tienes un certificado válido importado.")
            );
            return;
        }

        const cert = getActiveCertificate();
        if (!cert) {
            notify.error(t("common.error", "Error"), t("appDetail.errorCertActive", "No se pudo obtener el certificado activo."));
            return;
        }

        if (!params.downloadURL || params.downloadURL.trim() === "") {
            notify.error(t("common.error", "Error"), t("appDetail.errorNoDownload", "Esta app no tiene una URL de descarga disponible."));
            return;
        }

        cancelRef.current = false;
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setSigningState({
            isSigning: true,
            signingComplete: false,
            signingError: null,
            progress: 0,
            steps: getInitialSigningSteps(),
            appName: params.name || "App",
            appIcon: params.icon || "",
            appUrl: params.downloadURL || "",
            appVersion: params.version || "",
            appRepoName: params.repoName || "",
            currentJobId: "",
        });

        /**
         * Actualiza el estado de un paso específico.
         */
        const updateStep = (
            stepId: string,
            status: SigningStep["status"],
            detail?: string
        ) => {
            setSteps((prev) =>
                prev.map((s) =>
                    s.id === stepId ? { ...s, status, detail: detail || s.detail } : s
                )
            );
        };

        /**
         * Pequeño retraso para transiciones visuales.
         */
        const delay = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));

        try {
            // ── Paso 1: Verificar URL y preparar ──
            updateStep("download", "active", t("appDetail.verifyingUrl", "Verificando URL de descarga..."));
            setProgress(10);
            await delay(500);
            if (cancelRef.current) throw new Error("cancelled");

            // Marcar descarga como completada (el servidor descargará el IPA)
            updateStep("download", "completed", t("appDetail.urlReady", { name: params.name }));
            setProgress(20);

            // ── Paso 2: Validar certificado ──
            updateStep("validate", "active", t("appDetail.verifyingCert", { name: cert.name }));
            setProgress(30);
            await delay(500);
            if (cancelRef.current) throw new Error("cancelled");
            updateStep("validate", "completed", t("appDetail.certValid", "Certificado válido ✓"));
            setProgress(40);

            // ── Paso 3: Firma con el servidor ──
            // El servidor descarga el IPA, lo firma y devuelve las URLs
            updateStep("sign", "active", t("appDetail.sendingToServer", "Enviando al servidor de firma..."));
            setProgress(50);
            await delay(300);
            if (cancelRef.current) throw new Error("cancelled");

            let signingResult: SigningResult | null = null;
            try {
                signingResult = await signIPAWithBackend(
                    params.downloadURL,
                    params.name || "app",
                    cert,
                    ipaOptions.customBundleId || params.id,
                    ipaOptions.customVersion  || params.version,
                    signerPreference,
                    {
                        customBundleId:           ipaOptions.customBundleId,
                        customName:               ipaOptions.customName,
                        customVersion:            ipaOptions.customVersion,
                        enableFileSharing:        ipaOptions.enableFileSharing,
                        removeDeviceRestrictions: ipaOptions.removeDeviceRestrictions,
                        liquidGlass:              ipaOptions.liquidGlass,
                        sha256Only:               ipaOptions.sha256Only,
                        compressionLevel:         ipaOptions.compressionLevel,
                        dylibFiles:               ipaOptions.dylibFiles as any,
                    },
                    (event: SigningProgressEvent) => {
                        if (event.phase === "download") {
                            const dl    = event.downloaded ?? 0;
                            const total = event.total      ?? 0;
                            const detail = total > 0
                                ? `Descargando: ${formatSize(dl)} / ${formatSize(total)}`
                                : `Descargando: ${formatSize(dl)}`;
                            updateStep("sign", "active", detail);
                            if (total > 0) setProgress(50 + Math.round((dl / total) * 30));
                        } else if (event.phase === "sign") {
                            updateStep("sign", "active", "Firmando aplicación...");
                            setProgress(82);
                        }
                    },
                    (jobId: string) => {
                        setSigningState(p => ({ ...p, currentJobId: jobId }));
                    },
                    controller.signal
                );
                if (cancelRef.current) throw new Error("cancelled");
                setProgress(85);
                updateStep(
                    "sign",
                    "completed",
                    `Firmado correctamente: ${formatSize(signingResult.size)} ✓`
                );
            } catch (signError: any) {
                const msg = signError.message || t("appDetail.errorUnknown", "Error desconocido");
                // Pasar el error completo para diagnóstico (incluye la URL)
                throw new Error(msg);
            }

            // ── Paso 4: Instalar ──
            if (cancelRef.current) throw new Error("cancelled");
            updateStep("install", "active", t("appDetail.preparingInstall", "Preparando instalación..."));
            setProgress(90);
            await delay(300);
            if (cancelRef.current) throw new Error("cancelled");

            try {
                const installUrl = signingResult?.installUrl;
                const fileToInstall = signingResult?.signedUrl || params.downloadURL;

                if (isIOS) {
                    // En iOS, no disparamos la instalación automática directamente para evitar que Safari la bloquee.
                    // En su lugar, mostramos un diálogo de confirmación que requiere acción del usuario.
                    notify.confirm(
                        t("library.installConfirmTitle", "Instalación disponible"),
                        t("library.installConfirm", "La app se ha firmado correctamente. ¿Deseas iniciar la instalación?"),
                        () => {
                            installIPA(
                                fileToInstall,
                                params.downloadURL,
                                params.name || "app",
                                installUrl
                            );
                        },
                        undefined,
                        "download-outline"
                    );

                    setSigningState(p => ({
                        ...p,
                        progress: 100,
                        signingComplete: true,
                        isSigning: false,
                        installUrl,
                        signedUrl: fileToInstall,
                        steps: p.steps.map(s =>
                            s.id === "install"
                                ? {
                                    ...s,
                                    status: "completed",
                                    detail: t("appDetail.installReady", "Firma completada. Listo para instalar.")
                                  }
                                : s
                        )
                    }));
                } else {
                    await installIPA(
                        fileToInstall,
                        params.downloadURL,
                        params.name || "app",
                        installUrl
                    );

                    if (signingResult?.fileName) {
                        deleteSignedIPA(signingResult.fileName);
                    }

                    setSigningState(p => ({
                        ...p,
                        progress: 100,
                        signingComplete: true,
                        isSigning: false,
                        installUrl,
                        signedUrl: fileToInstall,
                        steps: p.steps.map(s =>
                            s.id === "install"
                                ? {
                                    ...s,
                                    status: "completed",
                                    detail: (Platform.OS === "web")
                                        ? t("appDetail.downloadedSuccess", "¡Archivo IPA descargado!")
                                        : t("appDetail.installStarted", "¡Instalación iniciada!")
                                  }
                                : s
                        )
                    }));
                }
            } catch (installError: any) {
                console.error("Error al iniciar la instalación:", installError);
                setSigningState(p => ({
                    ...p,
                    progress: 100,
                    signingComplete: true,
                    isSigning: false,
                    installUrl: signingResult?.installUrl,
                    signedUrl: signingResult?.signedUrl || params.downloadURL,
                    steps: p.steps.map(s =>
                        s.id === "install"
                            ? {
                                ...s,
                                status: "completed",
                                detail: t("appDetail.installFallback", "Firma completada. Usa la URL de instalación para instalar la app.")
                              }
                            : s
                    )
                }));
            }
            setIsSigning(false);

            // Guardar registro de instalación para la sección "Mis Apps"
            if (cert.expirationDate) {
                saveInstallation({
                    name: params.name || "App",
                    bundleId: params.id || "",
                    version: params.version || "",
                    iconUrl: params.icon || "",
                    ipaUrl: params.downloadURL || "",
                    certId: cert.id,
                    certName: cert.name,
                    certExpirationDate: cert.expirationDate,
                });
            }
        } catch (error: any) {
            console.error("Error en proceso de firma:", error);
            const msg = error.message || t("appDetail.errorUnknown", "Error desconocido");

            if (msg === "cancelled" || error.name === "AbortError" || msg.includes("aborted")) {
                setSteps((prev) =>
                    prev.map((s) =>
                        s.status === "active"
                            ? { ...s, status: "error", detail: t("appDetail.cancelledByUser", "Cancelado por el usuario") }
                            : s
                    )
                );
                setIsSigning(false);
            } else {
                // Traducir errores comunes de red
                let errorMsg = msg;
                if (msg === "Load failed") {
                    errorMsg = t("appDetail.errorConnection", "Error de conexión.");
                } else if (msg.includes("Network request failed")) {
                    errorMsg = t("appDetail.errorNetwork", "Error de red.");
                }

                setSteps((prev) =>
                    prev.map((s) =>
                        s.status === "active"
                            ? { ...s, status: "error", detail: errorMsg }
                            : s
                    )
                );
                setIsSigning(false);
                setSigningError(errorMsg);
            }
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
            }
        }
    }, [
        hasValidCertificate,
        getActiveCertificate,
        params.downloadURL,
        params.name,
        params.id,
        params.version,
        params.icon,
        params.repoName,
        signerPreference,
        ipaOptions,
        signingState.isSigning,
        isThisApp,
        saveInstallation,
        t
    ]);

    /**
     * Formatea bytes a texto legible.
     */
    const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    /**
     * Cancela la descarga/firma en curso.
     * Detiene la descarga real si hay una activa.
     */
    const cancelSigning = () => {
        notify.confirm(t("appDetail.cancelSigning", "Cancelar firma"), t("appDetail.cancelSigningConfirm", "¿Estás seguro?"), () => {
            cancelRef.current = true;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            // Cancelar también en el servidor (aborta descarga y proceso zsign)
            if (signingState.currentJobId) {
                cancelSigningJob(signingState.currentJobId);
                setSigningState(p => ({ ...p, currentJobId: "" }));
            }
        });
    };

    /**
     * Descarga el archivo .ipa original directamente en el dispositivo.
     */
    const handleDownloadOriginalIpa = () => {
        if (!params.downloadURL) {
            notify.error(t("common.error", "Error"), t("appDetail.errorNoDownload", "Esta app no tiene una URL de descarga disponible."));
            return;
        }
        Linking.openURL(params.downloadURL).catch((err) => {
            console.error("Error opening URL:", err);
            notify.error(t("common.error", "Error"), t("appDetail.errorDownloadFailed", "No se pudo abrir la URL de descarga."));
        });
    };

    return (
        <>
            <Stack.Screen
                options={{
                    headerTitle: params.name || "Detalle de App",
                    headerTitleAlign: "center",
                }}
            />

            <ScrollView
                style={{ flex: 1, backgroundColor: colors.background }}
                contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Cabecera de la app */}
                <Animated.View
                    entering={FadeInDown.duration(400)}
                    style={{
                        alignItems: "center",
                        marginBottom: 24,
                        paddingTop: 52,
                    }}
                >
                    {/* Icono grande — proxiado para evitar bloqueos CORS */}
                    <Image
                        source={{ uri: getImgProxyUrl(params.icon) }}
                        style={{
                            width: 96,
                            height: 96,
                            borderRadius: 22,
                            backgroundColor: colors.cardBorder,
                            marginBottom: 16,
                        }}
                    />

                    {/* Nombre */}
                    <Text
                        style={{
                            color: colors.text,
                            fontSize: 24,
                            fontWeight: "700",
                            textAlign: "center",
                        }}
                    >
                        {params.name}
                    </Text>

                    {/* Versión */}
                    <Text
                        style={{
                            color: colors.textSecondary,
                            fontSize: 15,
                            marginTop: 4,
                            textAlign: "center",
                            paddingHorizontal: 20,
                        }}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                    >
                        {t("appDetail.version", "Versión")} {params.version}
                    </Text>

                    {/* Repositorio de origen y categoría */}
                    {(params.repoName || params.category) ? (
                        <View
                            style={{
                                backgroundColor: `${colors.accent}18`,
                                borderRadius: 10,
                                paddingHorizontal: 12,
                                paddingVertical: 4,
                                marginTop: 8,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                            }}
                        >
                            {params.category === "jailbreak" ? (
                                <Ionicons name="lock-open-outline" size={14} color={colors.accent} />
                            ) : (
                                <Ionicons name="cube-outline" size={14} color={colors.accent} />
                            )}

                            {params.repoName && (
                                <Text
                                    style={{
                                        color: colors.accent,
                                        fontSize: 12,
                                        fontWeight: "500",
                                    }}
                                >
                                    {params.repoName}
                                </Text>
                            )}
                        </View>
                    ) : null}
                </Animated.View>

                {/* Info cards */}
                <Animated.View
                    entering={FadeInDown.delay(200).duration(400)}
                    style={{
                        flexDirection: "row",
                        gap: 12,
                        marginBottom: 20,
                    }}
                >
                    {/* Bundle ID */}
                    <View
                        style={{
                            flex: 1,
                            backgroundColor: colors.card,
                            borderRadius: 14,
                            padding: 14,
                            borderWidth: 1,
                            borderColor: colors.cardBorder,
                        }}
                    >
                        <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                            Bundle ID
                        </Text>
                        <Text
                            style={{
                                color: colors.text,
                                fontSize: 13,
                                fontWeight: "500",
                                marginTop: 4,
                            }}
                            numberOfLines={1}
                        >
                            {params.id}
                        </Text>
                    </View>

                    {/* Tamaño */}
                    <View
                        style={{
                            flex: 1,
                            backgroundColor: colors.card,
                            borderRadius: 14,
                            padding: 14,
                            borderWidth: 1,
                            borderColor: colors.cardBorder,
                        }}
                    >
                        <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                            {t("appDetail.size", "Tamaño")}
                        </Text>
                        <Text
                            style={{
                                color: colors.text,
                                fontSize: 13,
                                fontWeight: "500",
                                marginTop: 4,
                            }}
                        >
                            {params.size || t("common.unknown", "Desconocido")}
                        </Text>
                    </View>
                </Animated.View>

                {params.description ? (
                    <Animated.View
                        entering={FadeInDown.delay(300).duration(400)}
                        style={{
                            backgroundColor: colors.card,
                            borderRadius: 14,
                            padding: 16,
                            marginBottom: 20,
                            borderWidth: 1,
                            borderColor: colors.cardBorder,
                        }}
                    >
                        {/* Header con titulo y botón de traducir */}
                        <View
                            style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 8,
                            }}
                        >
                            <Text
                                style={{
                                    color: colors.textSecondary,
                                    fontSize: 11,
                                    fontWeight: "600",
                                    textTransform: "uppercase",
                                    letterSpacing: 1,
                                }}
                            >
                                {t("appDetail.description", "Descripción")}
                            </Text>
                            <Pressable
                                onPress={async () => {
                                    if (showTranslation) {
                                        setShowTranslation(false);
                                        return;
                                    }
                                    if (translatedDesc) {
                                        setShowTranslation(true);
                                        return;
                                    }
                                    setIsTranslating(true);
                                    try {
                                        const fullText = params.description || "";
                                        // Dividir en trozos de 400 chars (límite de MyMemory)
                                        const MAX_CHUNK = 400;
                                        const chunks: string[] = [];
                                        for (let i = 0; i < fullText.length; i += MAX_CHUNK) {
                                            chunks.push(fullText.slice(i, i + MAX_CHUNK));
                                        }

                                        const translatedChunks: string[] = [];
                                        for (const chunk of chunks) {
                                            const encoded = encodeURIComponent(chunk);
                                            const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|es`;
                                            let res: Response;
                                            try {
                                                res = await fetch(url);
                                            } catch {
                                                // Fallback con CORS proxy
                                                try {
                                                    res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
                                                } catch {
                                                    translatedChunks.push(chunk);
                                                    continue;
                                                }
                                            }
                                            let data: any = null;
                                            try {
                                                const textBody = await res.text();
                                                data = JSON.parse(textBody);
                                            } catch { /* respuesta no JSON, ignorar */ }
                                            if (data?.responseData?.translatedText) {
                                                translatedChunks.push(data.responseData.translatedText);
                                            } else {
                                                translatedChunks.push(chunk);
                                            }
                                        }
                                        const result = translatedChunks.join("");
                                        setTranslatedDesc(result);
                                        setShowTranslation(true);
                                    } catch (e) {
                                        console.error("Error al traducir:", e);
                                        notify.error(t("common.error", "Error"), t("appDetail.translateError", "No se pudo traducir."));
                                    } finally {
                                        setIsTranslating(false);
                                    }
                                }}
                                disabled={isTranslating}
                                style={({ pressed }) => ({
                                    backgroundColor: showTranslation ? `${colors.accent}20` : colors.cardBorder,
                                    borderRadius: 8,
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 4,
                                    opacity: pressed ? 0.7 : 1,
                                })}
                            >
                                {isTranslating ? (
                                    <ActivityIndicator size="small" color={colors.accent} />
                                ) : (
                                    <>
                                        <Ionicons
                                            name={showTranslation ? "language" : "language-outline"}
                                            size={14}
                                            color={showTranslation ? colors.accent : colors.textSecondary}
                                        />
                                        <Text
                                            style={{
                                                color: showTranslation ? colors.accent : colors.textSecondary,
                                                fontSize: 11,
                                                fontWeight: "500",
                                            }}
                                        >
                                            {showTranslation ? t("appDetail.showOriginal", "Original") : t("appDetail.translate", "Traducir")}
                                        </Text>
                                    </>
                                )}
                            </Pressable>
                        </View>

                        <Text
                            style={{
                                color: colors.text,
                                fontSize: 14,
                                lineHeight: 22,
                            }}
                        >
                            {showTranslation && translatedDesc ? translatedDesc : params.description}
                        </Text>
                    </Animated.View>
                ) : null}

                {/* Banner sin certificado */}
                {!hasValidCertificate && !isSigning && (
                    <Animated.View
                        entering={FadeInDown.delay(400).duration(400)}
                        style={{
                            backgroundColor: "#FFC10720",
                            borderRadius: 14,
                            padding: 14,
                            flexDirection: "row",
                            alignItems: "center",
                            marginBottom: 16,
                            borderWidth: 1,
                            borderColor: "#FFC10740",
                        }}
                    >
                        <Ionicons name="warning" size={22} color="#FFC107" />
                        <Text
                            style={{
                                color: "#FFC107",
                                fontSize: 13,
                                marginLeft: 10,
                                flex: 1,
                            }}
                        >
                            {t("appDetail.noCertBanner", "Necesitas importar un certificado válido antes de firmar.")}
                        </Text>
                    </Animated.View>
                )}

                {/* IPA Customizer — opciones pre-firma */}
                {!isSigning && !signingComplete && (
                    <Animated.View entering={FadeInDown.delay(400).duration(400)} style={{ marginBottom: 16 }}>
                        <IpaCustomizer
                            options={ipaOptions}
                            onChange={setIpaOptions}
                            ipaInfo={{
                                bundleId: params.id || "",
                                displayName: params.name || "",
                                shortVersion: params.version || "",
                            }}
                        />
                    </Animated.View>
                )}

                {/* Botones de acción */}
                {!isSigning && !signingComplete && (
                    <Animated.View entering={FadeInUp.delay(500).duration(400)}>
                        <View style={{ flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 20 }}>
                            {/* Botón Firmar e Instalar */}
                            <Pressable
                                onPress={startSigningProcess}
                                style={({ pressed }) => ({
                                    flex: 1,
                                    backgroundColor: hasValidCertificate
                                        ? colors.accent
                                        : colors.textSecondary,
                                    borderRadius: 14,
                                    height: 58,
                                    flexDirection: "row",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    gap: 10,
                                    opacity: pressed ? 0.8 : 1,
                                    // Sombra
                                    shadowColor: colors.accent,
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: hasValidCertificate ? 0.3 : 0,
                                    shadowRadius: 8,
                                })}
                            >
                                <Ionicons name="create-outline" size={22} color="#FFFFFF" />
                                <Text
                                    style={{
                                        color: "#FFFFFF",
                                        fontSize: 17,
                                        fontWeight: "700",
                                    }}
                                >
                                    {t("appDetail.installBtn", "Firmar e Instalar")}
                                </Text>
                            </Pressable>

                            {/* Botón Descargar IPA original */}
                            {params.downloadURL ? (
                                <Pressable
                                    onPress={handleDownloadOriginalIpa}
                                    style={({ pressed }) => ({
                                        width: 58,
                                        height: 58,
                                        backgroundColor: colors.card,
                                        borderRadius: 14,
                                        justifyContent: "center",
                                        alignItems: "center",
                                        borderWidth: 1,
                                        borderColor: colors.cardBorder,
                                        opacity: pressed ? 0.8 : 1,
                                    })}
                                >
                                    <Ionicons name="download-outline" size={24} color={colors.accent} />
                                </Pressable>
                            ) : null}
                        </View>

                        {/* Selector de Firmador Opcional */}
                        <Pressable 
                            style={{marginTop: 15, alignSelf: 'center'}}
                            onPress={() => {
                                const signers: Array<"auto" | "zsign" | "arksign"> = ["auto", "zsign", "arksign"];
                                const currentSigner = signerPreference === "speedysigner" ? "auto" : signerPreference;
                                const nextIdx = (signers.indexOf(currentSigner) + 1) % signers.length;
                                const nextVal = signers[nextIdx];
                                setSignerPreference(nextVal);
                                AsyncStorage.setItem('signer_pref', nextVal);
                            }}
                        >
                            <Text style={{color: colors.textSecondary, fontSize: 13, textAlign: 'center'}}>
                                ⚙️ {t("appDetail.signerLabel", { mode: 
                                    signerPreference === 'auto' ? t("appDetail.signerAuto", "Automático") : 
                                    signerPreference === 'zsign' ? t("appDetail.signerZsign", "zsign") : 
                                    signerPreference === 'arksign' ? t("appDetail.signerArksign", "ArkSign") : t("appDetail.signerSpeedysigner", "SpeedySigner")
                                }).replace('⚙️ ', '')}
                            </Text>
                        </Pressable>
                    </Animated.View>
                )}

                {/* Proceso de firma en curso */}
                {(isSigning || signingComplete || signingError) && (
                    <Animated.View entering={FadeInDown.duration(400)}>
                        {/* Barra de progreso */}
                        <ProgressBar
                            progress={progress}
                            label={signingComplete ? t("appDetail.completed", "Completado") : t("appDetail.signingProgress", "Progreso de firma")}
                            color={signingComplete ? "#4CAF50" : colors.accent}
                        />

                        {/* Log de pasos */}
                        <View style={{ marginTop: 16 }}>
                            <SigningLog steps={steps} />
                        </View>

                        {/* Botón cancelar */}
                        {isSigning && (
                            <Pressable
                                onPress={cancelSigning}
                                style={({ pressed }) => ({
                                    backgroundColor: "#FF4D4D20",
                                    borderRadius: 14,
                                    padding: 14,
                                    alignItems: "center",
                                    marginTop: 16,
                                    borderWidth: 1,
                                    borderColor: "#FF4D4D40",
                                    opacity: pressed ? 0.8 : 1,
                                })}
                            >
                                <Text
                                    style={{
                                        color: "#FF4D4D",
                                        fontSize: 15,
                                        fontWeight: "600",
                                    }}
                                >
                                    {t("appDetail.cancelBtn", "Cancelar")}
                                </Text>
                            </Pressable>
                        )}

                        {/* Mensaje de éxito */}
                        {signingComplete && !signingError && (
                            <View
                                style={{
                                    backgroundColor: `${colors.accent}12`,
                                    borderRadius: 14,
                                    padding: 18,
                                    marginTop: 16,
                                    alignItems: "center",
                                    borderWidth: 1,
                                    borderColor: `${colors.accent}30`,
                                    gap: 12,
                                }}
                            >
                                <Ionicons name="checkmark-circle" size={40} color="#4CAF50" />
                                <Text
                                    style={{
                                        color: colors.text,
                                        fontSize: 16,
                                        fontWeight: "700",
                                        textAlign: "center",
                                    }}
                                >
                                    {t("appDetail.signedSuccessTitle", "¡App firmada e instalada correctamente!")}
                                </Text>
                                <Text
                                    style={{
                                        color: colors.textSecondary,
                                        fontSize: 13,
                                        textAlign: "center",
                                        lineHeight: 18,
                                    }}
                                >
                                    {Platform.OS === 'web' && !isIOS
                                        ? t("appDetail.downloadedSuccess", "¡Archivo IPA descargado! Revisa tu carpeta de descargas.")
                                        : t("appDetail.findOnHome", { name: params.name })
                                    }
                                </Text>

                                {/* Botón manual de Instalar / Descargar para asegurar que la acción sea directa del usuario */}
                                <Pressable
                                    onPress={() => {
                                        installIPA(
                                            signingState.signedUrl || params.downloadURL,
                                            params.downloadURL,
                                            params.name || "app",
                                            signingState.installUrl
                                        );
                                    }}
                                    style={({ pressed }) => ({
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 8,
                                        backgroundColor: pressed ? `${colors.accent}cc` : colors.accent,
                                        borderRadius: 12,
                                        paddingHorizontal: 20,
                                        paddingVertical: 12,
                                        width: "100%",
                                        marginTop: 6,
                                        shadowColor: colors.accent,
                                        shadowOffset: { width: 0, height: 2 },
                                        shadowOpacity: 0.2,
                                        shadowRadius: 4,
                                    })}
                                >
                                    <Ionicons 
                                        name={isIOS ? "download-outline" : "download"} 
                                        size={18} 
                                        color="#FFFFFF" 
                                    />
                                    <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 15 }}>
                                        {isIOS
                                            ? t("appDetail.installManual", "Instalar Aplicación")
                                            : t("appDetail.downloadManual", "Descargar IPA")
                                        }
                                    </Text>
                                </Pressable>
                            </View>
                        )}

                        {/* Mensaje de error */}
                        {signingError && (
                            <View
                                style={{
                                    backgroundColor: "#FF4D4D20",
                                    borderRadius: 14,
                                    padding: 16,
                                    marginTop: 16,
                                    alignItems: "center",
                                    borderWidth: 1,
                                    borderColor: "#FF4D4D40",
                                }}
                            >
                                <Ionicons name="close-circle" size={40} color="#FF4D4D" />
                                <Text
                                    style={{
                                        color: "#FF4D4D",
                                        fontSize: 16,
                                        fontWeight: "600",
                                        marginTop: 8,
                                    }}
                                >
                                    {t("appDetail.errorProcess", "Error en el proceso")}
                                </Text>
                                <Text
                                    style={{
                                        color: colors.textSecondary,
                                        fontSize: 13,
                                        marginTop: 4,
                                        textAlign: "center",
                                    }}
                                >
                                    {signingError}
                                </Text>
                                <Pressable
                                    onPress={() => {
                                        setSigningState(p => ({
                                            ...p,
                                            signingError: null,
                                            signingComplete: false,
                                            isSigning: false,
                                            progress: 0,
                                            steps: getInitialSigningSteps(),
                                            appUrl: "",
                                            appVersion: "",
                                            appRepoName: "",
                                        }));
                                    }}
                                    style={({ pressed }) => ({
                                        backgroundColor: colors.accent,
                                        borderRadius: 12,
                                        paddingHorizontal: 24,
                                        paddingVertical: 12,
                                        marginTop: 12,
                                        opacity: pressed ? 0.8 : 1,
                                    })}
                                >
                                    <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>{t("appDetail.retry", "Reintentar")}</Text>
                                </Pressable>
                            </View>
                        )}
                    </Animated.View>
                )}
            </ScrollView>
        </>
    );
}
