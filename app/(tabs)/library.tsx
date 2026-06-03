/**
 * library.tsx - Mis Apps Instaladas
 * Muestra todas las apps que han sido firmadas e instaladas con SpeedySign,
 * junto con los días restantes antes de que el certificado revoque la app.
 */

import React, { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
    View,
    Text,
    ScrollView,
    Image,
    Pressable,
    ActivityIndicator,
    RefreshControl,
    Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "../../hooks/useTheme";
import { useHeaderHeight } from "@react-navigation/elements";
import {
    useInstalledApps,
    daysRemaining,
    getRevocationStatus,
    InstalledApp,
} from "../../hooks/useInstalledApps";
import { useCertificates } from "../../hooks/useCertificates";
import { signIPAWithBackend, installIPA, deleteSignedIPA } from "../../utils/ipaDownloader";
import { notify } from "../../utils/notify";
import { useTranslation } from "react-i18next";
import { getImgProxyUrl } from "../../utils/imgProxy";

/**
 * Badge de días restantes con color dinámico.
 */
function RevocationBadge({ certExpirationDate }: { certExpirationDate: string }) {
    const days = daysRemaining(certExpirationDate);
    const { color, label, urgent } = getRevocationStatus(days);

    return (
        <View
            style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: `${color}20`,
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 4,
                gap: 4,
                borderWidth: 1,
                borderColor: `${color}40`,
            }}
        >
            {urgent && (
                <Ionicons name="warning" size={11} color={color} />
            )}
            <Text style={{ color, fontSize: 11, fontWeight: "700" }}>
                {label}
            </Text>
        </View>
    );
}

/**
 * Tarjeta de app instalada.
 */
function InstalledAppCard({
    app,
    onDelete,
    onResign,
    resigningId,
    index,
}: {
    app: InstalledApp;
    onDelete: (id: string) => void;
    onResign: (app: InstalledApp) => void;
    resigningId: string | null;
    index: number;
}) {
    const { colors } = useTheme();
    const days = daysRemaining(app.certExpirationDate);
    const isRevoked = days <= 0;

    return (
        <Animated.View
            entering={FadeInDown.delay(index * 60).duration(300)}
            style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                padding: 14,
                marginBottom: 10,
                borderWidth: 1,
                borderColor: isRevoked
                    ? "rgba(158,158,158,0.3)"
                    : colors.cardBorder,
                opacity: isRevoked ? 0.7 : 1,
            }}
        >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {/* Icono de la app */}
                <View
                    style={{
                        width: 52,
                        height: 52,
                        borderRadius: 13,
                        overflow: "hidden",
                        backgroundColor: colors.cardBorder,
                    }}
                >
                    {app.iconUrl ? (
                        <Image
                            source={{ uri: getImgProxyUrl(app.iconUrl) }}
                            style={{ width: 52, height: 52 }}
                            resizeMode="cover"
                        />
                    ) : (
                        <View
                            style={{
                                width: 52,
                                height: 52,
                                justifyContent: "center",
                                alignItems: "center",
                            }}
                        >
                            <Ionicons
                                name="cube-outline"
                                size={26}
                                color={colors.textSecondary}
                            />
                        </View>
                    )}
                </View>

                {/* Info de la app */}
                <View style={{ flex: 1, gap: 3 }}>
                    <Text
                        style={{
                            color: colors.text,
                            fontSize: 15,
                            fontWeight: "600",
                        }}
                        numberOfLines={1}
                    >
                        {app.name}
                    </Text>
                    <Text
                        style={{
                            color: colors.textSecondary,
                            fontSize: 12,
                        }}
                        numberOfLines={1}
                    >
                        v{app.version} · {app.certName}
                    </Text>

                    {/* Badge de días restantes */}
                    <View style={{ flexDirection: "row", marginTop: 2 }}>
                        <RevocationBadge certExpirationDate={app.certExpirationDate} />
                    </View>
                </View>

                {/* Botón Descargar (forzar descarga/instalación manual) */}
                {app.ipaUrl ? (
                    <Pressable
                        onPress={() => installIPA(app.ipaUrl!, app.ipaUrl!, app.name)}
                        hitSlop={8}
                        style={({ pressed }) => ({
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            backgroundColor: pressed
                                ? `${colors.accent}30`
                                : `${colors.accent}15`,
                            borderWidth: 1,
                            borderColor: `${colors.accent}30`,
                            justifyContent: "center",
                            alignItems: "center",
                            marginRight: 6,
                        })}
                    >
                        <Ionicons name="download-outline" size={17} color={colors.accent} />
                    </Pressable>
                ) : null}

                {/* Botón re-firmar */}
                {app.ipaUrl ? (
                    <Pressable
                        onPress={() => onResign(app)}
                        disabled={resigningId !== null}
                        hitSlop={8}
                        style={({ pressed }) => ({
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            backgroundColor: pressed
                                ? `${colors.accent}30`
                                : `${colors.accent}15`,
                            borderWidth: 1,
                            borderColor: `${colors.accent}30`,
                            justifyContent: "center",
                            alignItems: "center",
                            marginRight: 6,
                        })}
                    >
                        {resigningId === app.id ? (
                            <ActivityIndicator size="small" color={colors.accent} />
                        ) : (
                            <Ionicons name="refresh-outline" size={17} color={colors.accent} />
                        )}
                    </Pressable>
                ) : null}

                {/* Botón eliminar */}
                <Pressable
                    onPress={() => onDelete(app.id)}
                    hitSlop={8}
                    style={({ pressed }) => ({
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        backgroundColor: pressed
                            ? `${colors.danger}20`
                            : `${colors.danger}10`,
                        borderWidth: 1,
                        borderColor: `${colors.danger}28`,
                        justifyContent: "center",
                        alignItems: "center",
                    })}
                >
                    <Ionicons name="trash-outline" size={17} color={colors.danger} />
                </Pressable>
            </View>
        </Animated.View>
    );
}

/**
 * Pantalla principal de Mis Apps.
 */
export default function LibraryScreen() {
    const { colors } = useTheme();
    const headerHeight = useHeaderHeight();
    const { t } = useTranslation();
    const { installedApps, loading, removeInstallation, reload, saveInstallation } =
        useInstalledApps();
    const { getActiveCertificate } = useCertificates();

    const [refreshing, setRefreshing] = React.useState(false);
    const [resigningId, setResigningId] = useState<string | null>(null);
    const [resigningAll, setResigningAll] = useState(false);
    const [signerPreference, setSignerPreference] = useState<"auto" | "zsign" | "arksign" | "zsign-rs">("auto");

    // Recargar apps instaladas cada vez que el usuario navega a esta pantalla.
    // Necesario porque app-detail escribe en AsyncStorage desde otra instancia del hook.
    useFocusEffect(
        useCallback(() => {
            reload();
            AsyncStorage.getItem('signer_pref').then((val) => {
                if (val === "auto" || val === "zsign" || val === "arksign" || val === "zsign-rs") {
                    setSignerPreference(val as any);
                }
            });
        }, [reload])
    );

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        await reload();
        setRefreshing(false);
    }, [reload]);

    const handleDelete = useCallback(
        (id: string) => {
            notify.confirm(
                t("library.deleteTitle", "Eliminar registro"),
                t(
                    "library.deleteMsg",
                    "¿Eliminar este registro de instalación? La app en tu dispositivo no se desinstala."
                ),
                async () => {
                    await removeInstallation(id);
                    notify.success(
                        t("common.done", "¡Listo!"),
                        t("library.deleteSuccess", "Registro eliminado.")
                    );
                }
            );
        },
        [removeInstallation, t]
    );

    const resignApp = useCallback(async (app: InstalledApp) => {
        if (!app.ipaUrl) {
            notify.error(t("library.noUrlTitle", "Sin URL"), t("library.noUrlForResign", "Esta app no tiene URL de IPA guardada para re-firmar."));
            return;
        }
        const cert = getActiveCertificate();
        if (!cert) {
            notify.error(t("library.noCertTitle", "Sin certificado"), t("library.noCertActive", "No hay ningún certificado activo. Importa uno en Ajustes → Certificados."));
            return;
        }

        setResigningId(app.id);
        try {
            const result = await signIPAWithBackend(app.ipaUrl, app.name, cert, app.bundleId, app.version, signerPreference);
            
            const isIOS = Platform.OS === "ios" || 
                (Platform.OS === "web" && typeof navigator !== "undefined" && (
                    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
                ));

            if (isIOS) {
                notify.confirm(
                    t("library.installConfirmTitle", "Instalación disponible"),
                    t("library.installConfirm", "La app se ha firmado correctamente. ¿Deseas iniciar la instalación?"),
                    () => {
                        installIPA(result.signedUrl, app.ipaUrl!, app.name, result.installUrl);
                    },
                    undefined,
                    "download-outline"
                );
            } else {
                await installIPA(result.signedUrl, app.ipaUrl, app.name, result.installUrl);
                if (result.fileName) {
                    deleteSignedIPA(result.fileName).catch(() => {});
                }
            }

            await saveInstallation({
                name: app.name,
                bundleId: app.bundleId,
                version: app.version,
                iconUrl: app.iconUrl,
                ipaUrl: app.ipaUrl,
                certId: cert.id,
                certName: cert.name,
                certExpirationDate: cert.expirationDate,
            });

            if (!isIOS) {
                notify.success(t("library.resignedTitle", "Re-firmada"), t("library.resignedDesc", "{{name}} firmada con {{cert}}", { name: app.name, cert: cert.name }));
            }
        } catch (e: any) {
            notify.error(t("library.resignErrorTitle", "Error al re-firmar"), e.message || t("common.error", "Error"));
        } finally {
            setResigningId(null);
        }
    }, [getActiveCertificate, saveInstallation, t, signerPreference]);

    const handleResignAll = useCallback(async () => {
        const appsWithUrl = installedApps.filter(a => a.ipaUrl);
        if (appsWithUrl.length === 0) {
            notify.error(t("library.noAppsTitle", "Sin apps"), t("library.noAppsWithUrl", "Ninguna app tiene URL guardada para re-firmar."));
            return;
        }
        const cert = getActiveCertificate();
        if (!cert) {
            notify.error(t("library.noCertTitle", "Sin certificado"), t("library.noCertActive", "No hay ningún certificado activo."));
            return;
        }
        setResigningAll(true);
        let ok = 0, fail = 0;
        for (const app of appsWithUrl) {
            setResigningId(app.id);
            try {
                const result = await signIPAWithBackend(app.ipaUrl!, app.name, cert, app.bundleId, app.version, signerPreference);
                
                const isIOS = Platform.OS === "ios" || 
                    (Platform.OS === "web" && typeof navigator !== "undefined" && (
                        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
                    ));

                if (isIOS) {
                    notify.confirm(
                        t("library.installConfirmTitle", "Instalación disponible"),
                        t("library.installConfirm", "La app se ha firmado correctamente. ¿Deseas iniciar la instalación?"),
                        () => {
                            installIPA(result.signedUrl, app.ipaUrl!, app.name, result.installUrl);
                        },
                        undefined,
                        "download-outline"
                    );
                } else {
                    await installIPA(result.signedUrl, app.ipaUrl!, app.name, result.installUrl);
                    if (result.fileName) {
                        deleteSignedIPA(result.fileName).catch(() => {});
                    }
                }

                await saveInstallation({
                    name: app.name, bundleId: app.bundleId, version: app.version,
                    iconUrl: app.iconUrl, ipaUrl: app.ipaUrl,
                    certId: cert.id, certName: cert.name, certExpirationDate: cert.expirationDate,
                });
                ok++;
            } catch {
                fail++;
            }
        }
        setResigningId(null);
        setResigningAll(false);
        const msg = fail > 0
            ? t("library.resignAllFail", "{{ok}} firmadas, {{fail}} fallaron", { ok, fail })
            : t("library.resignAllDesc", "{{ok}} firmadas correctamente", { ok });
        notify.success(t("library.resignAllTitle", "Re-firma completada"), msg);
    }, [installedApps, getActiveCertificate, saveInstallation, t, signerPreference]);

    // Separar apps vigentes y revocadas
    const active = installedApps.filter(
        (a) => daysRemaining(a.certExpirationDate) > 0
    );
    const revoked = installedApps.filter(
        (a) => daysRemaining(a.certExpirationDate) <= 0
    );

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
                <ActivityIndicator color={colors.accent} size="large" />
            </View>
        );
    }

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: colors.background }}
            contentContainerStyle={{
                padding: 16,
                paddingTop: headerHeight + 16,
                paddingBottom: 120,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                    tintColor={colors.accent}
                />
            }
        >
            {installedApps.length === 0 ? (
                /* ── Estado vacío ── */
                <Animated.View
                    entering={FadeInDown.duration(400)}
                    style={{ alignItems: "center", marginTop: 80, gap: 12 }}
                >
                    <View
                        style={{
                            width: 72,
                            height: 72,
                            borderRadius: 20,
                            backgroundColor: `${colors.accent}15`,
                            justifyContent: "center",
                            alignItems: "center",
                            marginBottom: 4,
                        }}
                    >
                        <Ionicons
                            name="grid-outline"
                            size={36}
                            color={colors.accent}
                        />
                    </View>
                    <Text
                        style={{
                            color: colors.text,
                            fontSize: 18,
                            fontWeight: "700",
                            textAlign: "center",
                        }}
                    >
                        {t("library.emptyTitle", "Sin apps instaladas")}
                    </Text>
                    <Text
                        style={{
                            color: colors.textSecondary,
                            fontSize: 14,
                            textAlign: "center",
                            maxWidth: 280,
                            lineHeight: 20,
                        }}
                    >
                        {t(
                            "library.emptyDesc",
                            "Las apps que firmes e instales con SpeedySign aparecerán aquí con el tiempo restante antes de su revocación."
                        )}
                    </Text>
                </Animated.View>
            ) : (
                <>
                    {/* ── Botón Re-firmar todas ── */}
                    {installedApps.some(a => a.ipaUrl) && (
                        <Pressable
                            onPress={handleResignAll}
                            disabled={resigningAll || resigningId !== null}
                            style={({ pressed }) => ({
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 8,
                                backgroundColor: pressed
                                    ? `${colors.accent}25`
                                    : `${colors.accent}12`,
                                borderRadius: 16,
                                padding: 14,
                                marginBottom: 16,
                                borderWidth: 1,
                                borderColor: `${colors.accent}35`,
                                opacity: (resigningAll || resigningId !== null) ? 0.55 : 1,
                            })}
                        >
                            {resigningAll ? (
                                <ActivityIndicator size="small" color={colors.accent} />
                            ) : (
                                <Ionicons name="refresh-circle-outline" size={20} color={colors.accent} />
                            )}
                            <Text style={{ color: colors.accent, fontWeight: "600", fontSize: 14 }}>
                                {resigningAll ? t("library.resigningAll", "Re-firmando...") : t("library.resignAll", "Re-firmar todas")}
                            </Text>
                        </Pressable>
                    )}

                    {/* ── Apps vigentes ── */}
                    {active.length > 0 && (
                        <>
                            <Text
                                style={{
                                    color: colors.textSecondary,
                                    fontSize: 12,
                                    fontWeight: "700",
                                    textTransform: "uppercase",
                                    letterSpacing: 1,
                                    marginBottom: 10,
                                }}
                            >
                                {t("library.sectionActive", "Activas")} · {active.length}
                            </Text>
                            {active.map((app, i) => (
                                <InstalledAppCard
                                    key={app.id}
                                    app={app}
                                    onDelete={handleDelete}
                                    onResign={resignApp}
                                    resigningId={resigningId}
                                    index={i}
                                />
                            ))}
                        </>
                    )}

                    {/* ── Apps revocadas ── */}
                    {revoked.length > 0 && (
                        <>
                            <Text
                                style={{
                                    color: colors.textSecondary,
                                    fontSize: 12,
                                    fontWeight: "700",
                                    textTransform: "uppercase",
                                    letterSpacing: 1,
                                    marginTop: active.length > 0 ? 20 : 0,
                                    marginBottom: 10,
                                }}
                            >
                                {t("library.sectionRevoked", "Revocadas")} · {revoked.length}
                            </Text>
                            {revoked.map((app, i) => (
                                <InstalledAppCard
                                    key={app.id}
                                    app={app}
                                    onDelete={handleDelete}
                                    onResign={resignApp}
                                    resigningId={resigningId}
                                    index={active.length + i}
                                />
                            ))}
                        </>
                    )}
                </>
            )}
        </ScrollView>
    );
}
