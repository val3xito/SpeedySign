/**
 * FloatingSigningBubble.tsx
 * Burbuja flotante que muestra el progreso de firma cuando el usuario
 * ha navegado fuera de la pantalla de detalle de app.
 *
 * - Se oculta automáticamente mientras el usuario esté en app-detail/
 * - Muestra ícono de la app, nombre, paso activo y porcentaje
 * - Al pulsarla se expande un panel con el log completo de pasos
 * - Se auto-oculta 4 s después de completar o fallar
 */

import React, { useEffect, useRef, useState } from "react";
import {
    View,
    Text,
    Pressable,
    Modal,
    ScrollView,
    Image,
    StyleSheet,
    Dimensions,
    Platform,
} from "react-native";
import Animated, {
    FadeInDown,
    FadeOutDown,
    Easing,
    cancelAnimation,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../hooks/useTheme";
import { useSigningContext } from "../contexts/SigningContext";
import { cancelSigningJob } from "../utils/ipaDownloader";
import { SigningLog } from "./SigningLog";
import { ProgressBar } from "./ProgressBar";
import { getImgProxyUrl } from "../utils/imgProxy";

const { width: SCREEN_W } = Dimensions.get("window");
const BUBBLE_W = Math.min(SCREEN_W - 32, 360);
const TAB_BAR_BOTTOM_LIFT = 18;

export function FloatingSigningBubble() {
    const { colors, isDark } = useTheme();
    const { signingState, setSigningState, cancelRef, abortControllerRef } = useSigningContext();
    const { isSigning, signingComplete, signingError, progress, steps, appName, appIcon } = signingState;

    const pathname = usePathname();
    const insets = useSafeAreaInsets();

    const [modalVisible, setModalVisible] = useState(false);
    // Control de visibilidad propia (auto-ocultar tras fin)
    const [visible, setVisible] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusRotation = useSharedValue(0);

    // ── Lógica de visibilidad ───────────────────────────────────────────────
    useEffect(() => {
        if (hideTimer.current) clearTimeout(hideTimer.current);

        if (isSigning) {
            setVisible(true);
        } else if (signingComplete || signingError) {
            setVisible(true);
            // Auto-ocultar después de 4 s
            hideTimer.current = setTimeout(() => {
                setVisible(false);
                setModalVisible(false);
            }, 4000);
        } else {
            setVisible(false);
        }

        return () => {
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, [isSigning, signingComplete, signingError]);

    useEffect(() => {
        if (isSigning && !signingComplete && !signingError) {
            statusRotation.value = 0;
            statusRotation.value = withRepeat(
                withTiming(360, { duration: 900, easing: Easing.linear }),
                -1,
                false
            );
            return;
        }

        cancelAnimation(statusRotation);
        statusRotation.value = withTiming(0, { duration: 120 });
    }, [isSigning, signingComplete, signingError, statusRotation]);

    const statusIconStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${statusRotation.value}deg` }],
    }));

    // ── No mostrar si estamos EN la pantalla de firma o no hay proceso ──────
    const isOnDetailScreen = pathname.startsWith("/app-detail");

    // Si no hay nada que mostrar (ni burbuja ni panel), no renderizar nada
    if (!visible && !modalVisible) return null;

    // ── Datos del paso activo ────────────────────────────────────────────────
    const activeStep = steps.find(s => s.status === "active");
    const errorStep = steps.find(s => s.status === "error");
    const currentStep = errorStep || activeStep;

    const statusColor = signingError
        ? "#FF453A"
        : signingComplete
            ? "#34C759"
            : colors.accent;

    const statusIcon: any = signingError
        ? "close-circle"
        : signingComplete
            ? "checkmark-circle"
            : "sync-outline";

    // Posición: justo encima del tab bar (BAR=56, BUBBLE_RISE=16, padding=12 + elevacion)
    const bottomOffset = insets.bottom + 56 + 16 + 12 + TAB_BAR_BOTTOM_LIFT;

    // La burbuja pill se oculta si el panel está abierto o si estamos en la pantalla de firma
    const showBubble = visible && !isOnDetailScreen && !modalVisible;

    return (
        <>
            {/* ── Burbuja flotante ─────────────────────────────────────────── */}
            {showBubble && <Animated.View
                entering={FadeInDown.springify().damping(18).stiffness(160)}
                exiting={FadeOutDown.duration(250)}
                style={[
                    styles.bubbleWrapper,
                    { bottom: bottomOffset },
                    // En web, usar position fixed para que no se mueva al hacer scroll
                    Platform.OS === "web" && { position: "fixed" as any },
                ]}
                pointerEvents="box-none"
            >
                <Pressable
                    onPress={() => setModalVisible(true)}
                    style={({ pressed }) => [
                        styles.bubble,
                        {
                            backgroundColor: isDark
                                ? "rgba(28,28,30,0.96)"
                                : "rgba(255,255,255,0.96)",
                            borderColor: isDark
                                ? "rgba(255,255,255,0.12)"
                                : "rgba(0,0,0,0.08)",
                            opacity: pressed ? 0.92 : 1,
                            shadowColor: statusColor,
                        },
                    ]}
                >
                    {/* Icono de la app */}
                    <View style={styles.iconWrapper}>
                        {appIcon ? (
                            <Image
                                source={{ uri: getImgProxyUrl(appIcon) }}
                                style={styles.appIcon}
                            />
                        ) : (
                            <View style={[styles.appIconFallback, { backgroundColor: `${colors.accent}22` }]}>
                                <Ionicons name="cube-outline" size={20} color={colors.accent} />
                            </View>
                        )}
                        {/* Badge de estado */}
                        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                            {isSigning && !signingComplete && !signingError ? (
                                <Animated.View style={statusIconStyle}>
                                    <Ionicons name={statusIcon} size={10} color="#fff" />
                                </Animated.View>
                            ) : (
                                <Ionicons name={statusIcon} size={10} color="#fff" />
                            )}
                        </View>
                    </View>

                    {/* Texto central */}
                    <View style={styles.textArea}>
                        <Text
                            style={[styles.appName, { color: colors.text }]}
                            numberOfLines={1}
                        >
                            {appName}
                        </Text>
                        <Text
                            style={[styles.stepLabel, { color: colors.textSecondary }]}
                            numberOfLines={1}
                        >
                            {signingError
                                ? (errorStep?.detail || "Error al firmar")
                                : signingComplete
                                    ? "¡Firma completada!"
                                    : (currentStep?.detail || currentStep?.label || "Procesando...")}
                        </Text>

                        {/* Mini barra de progreso */}
                        <View style={[styles.miniBarBg, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]}>
                            <View
                                style={[
                                    styles.miniBarFill,
                                    {
                                        width: `${progress}%`,
                                        backgroundColor: statusColor,
                                    },
                                ]}
                            />
                        </View>
                    </View>

                    {/* Porcentaje */}
                    <Text style={[styles.percent, { color: statusColor }]}>
                        {signingComplete ? "✓" : `${progress}%`}
                    </Text>

                    {/* Chevron */}
                    <Ionicons name="chevron-up" size={14} color={colors.textSecondary} style={{ marginLeft: 2 }} />
                </Pressable>
            </Animated.View>}

            {/* ── Modal con log completo ───────────────────────────────────── */}
            <Modal
                visible={modalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setModalVisible(false)}
            >
                <Pressable
                    style={styles.modalOverlay}
                    onPress={() => setModalVisible(false)}
                >
                    <Pressable
                        style={[
                            styles.modalSheet,
                            {
                                backgroundColor: isDark ? "#1C1C1E" : "#F2F2F7",
                                paddingBottom: insets.bottom + 16,
                            },
                        ]}
                        onPress={() => { }}
                    >
                        {/* Handle */}
                        <View style={[styles.handle, { backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)" }]} />

                        {/* Header */}
                        <View style={styles.sheetHeader}>
                            {appIcon ? (
                                <Image source={{ uri: getImgProxyUrl(appIcon) }} style={styles.sheetIcon} />
                            ) : (
                                <View style={[styles.sheetIconFallback, { backgroundColor: `${colors.accent}22` }]}>
                                    <Ionicons name="cube-outline" size={24} color={colors.accent} />
                                </View>
                            )}
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                                    {appName}
                                </Text>
                                <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
                                    {signingError
                                        ? "Error durante la firma"
                                        : signingComplete
                                            ? "Proceso completado"
                                            : "Firmando..."}
                                </Text>
                            </View>
                            <Pressable
                                onPress={() => setModalVisible(false)}
                                hitSlop={12}
                                style={[styles.closeBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)" }]}
                            >
                                <Ionicons name="close" size={16} color={colors.textSecondary} />
                            </Pressable>
                        </View>

                        {/* Barra de progreso completa */}
                        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                            <ProgressBar
                                progress={progress}
                                label={signingComplete ? "Completado" : signingError ? "Error" : "Progreso de firma"}
                                color={statusColor}
                            />
                        </View>

                        {/* Log de pasos */}
                        <ScrollView
                            style={{ paddingHorizontal: 16 }}
                            contentContainerStyle={{ paddingBottom: 8 }}
                            showsVerticalScrollIndicator={false}
                        >
                            <SigningLog steps={steps} />

                            {/* Botón cancelar desde el modal */}
                            {isSigning && (
                                <Pressable
                                    onPress={() => {
                                        cancelRef.current = true;
                                        if (abortControllerRef.current) {
                                            abortControllerRef.current.abort();
                                            abortControllerRef.current = null;
                                        }
                                        // Cancelar también en el servidor
                                        if (signingState.currentJobId) {
                                            cancelSigningJob(signingState.currentJobId);
                                        }
                                        // Feedback inmediato en UI
                                        setSigningState(prev => ({
                                            ...prev,
                                            isSigning: false,
                                            currentJobId: "",
                                            steps: prev.steps.map(s =>
                                                s.status === "active"
                                                    ? { ...s, status: "error", detail: "Cancelado por el usuario" }
                                                    : s
                                            ),
                                        }));
                                        setModalVisible(false);
                                    }}
                                    style={({ pressed }) => [
                                        styles.cancelBtn,
                                        { opacity: pressed ? 0.8 : 1 },
                                    ]}
                                >
                                    <Ionicons name="stop-circle-outline" size={16} color="#FF453A" />
                                    <Text style={styles.cancelText}>Cancelar firma</Text>
                                </Pressable>
                            )}
                        </ScrollView>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    bubbleWrapper: {
        position: "absolute",
        left: 16,
        right: 16,
        zIndex: 999,
    },
    bubble: {
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 18,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: 1,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
        gap: 10,
    },
    iconWrapper: {
        position: "relative",
    },
    appIcon: {
        width: 40,
        height: 40,
        borderRadius: 10,
    },
    appIconFallback: {
        width: 40,
        height: 40,
        borderRadius: 10,
        justifyContent: "center",
        alignItems: "center",
    },
    statusBadge: {
        position: "absolute",
        bottom: -3,
        right: -3,
        width: 16,
        height: 16,
        borderRadius: 8,
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 1.5,
        borderColor: "transparent",
    },
    textArea: {
        flex: 1,
        gap: 2,
    },
    appName: {
        fontSize: 13,
        fontWeight: "600",
        letterSpacing: -0.2,
    },
    stepLabel: {
        fontSize: 11,
        letterSpacing: -0.1,
    },
    miniBarBg: {
        height: 3,
        borderRadius: 2,
        marginTop: 4,
        overflow: "hidden",
    },
    miniBarFill: {
        height: 3,
        borderRadius: 2,
    },
    percent: {
        fontSize: 13,
        fontWeight: "700",
        minWidth: 32,
        textAlign: "right",
    },
    modalOverlay: {
        flex: 1,
        ...(Platform.OS === "web" ? {
            position: "fixed" as any,
            top: 0, left: 0, right: 0, bottom: 0,
        } : {}),
        backgroundColor: "transparent",
        justifyContent: "flex-end",
    },
    modalSheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 12,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        alignSelf: "center",
        marginBottom: 16,
    },
    sheetHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        marginBottom: 16,
        gap: 12,
    },
    sheetIcon: {
        width: 48,
        height: 48,
        borderRadius: 12,
    },
    sheetIconFallback: {
        width: 48,
        height: 48,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
    },
    sheetTitle: {
        fontSize: 16,
        fontWeight: "700",
    },
    sheetSubtitle: {
        fontSize: 13,
        marginTop: 2,
    },
    closeBtn: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: "center",
        alignItems: "center",
    },
    cancelBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        marginTop: 16,
        padding: 14,
        borderRadius: 12,
        backgroundColor: "#FF453A18",
        borderWidth: 1,
        borderColor: "#FF453A30",
    },
    cancelText: {
        color: "#FF453A",
        fontSize: 14,
        fontWeight: "600",
    },
});
