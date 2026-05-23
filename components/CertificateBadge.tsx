/**
 * CertificateBadge.tsx
 * Tarjeta de certificado con código de colores por estado:
 *   - Verde: válido y activado
 *   - Amarillo/Ámbar: válido pero no activado
 *   - Rojo: expirado o próximo a expirar
 * Incluye un toggle para activar/desactivar (solo uno activo a la vez).
 */

import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInRight } from "react-native-reanimated";
import { useTheme } from "../hooks/useTheme";
import { Certificate } from "../utils/certValidator";
import {
    getCertificateStatus,
    formatExpirationDate,
} from "../utils/certValidator";

/** Props del componente CertificateBadge */
interface CertificateBadgeProps {
    certificate: Certificate;
    index: number;
    onDelete?: () => void;
    isActive?: boolean;
    onToggleActive?: (active: boolean) => void;
    onVerify?: () => void;
}

/** Paleta de colores por estado de la tarjeta */
const CARD_COLORS = {
    /** Activo y válido */
    green: {
        border: "#34C759",
        bgDark: "rgba(52, 199, 89, 0.10)",
        bgLight: "rgba(52, 199, 89, 0.06)",
        badge: "#34C759",
        badgeText: "#FFFFFF",
        label: "Activado",
        icon: "power" as const,
    },
    /** Válido pero no activado */
    amber: {
        border: "#FFD60A",
        bgDark: "rgba(255, 214, 10, 0.08)",
        bgLight: "rgba(255, 214, 10, 0.05)",
        badge: "#FFD60A",
        badgeText: "#1A1A1A",
        label: "No activado",
        icon: "power-outline" as const,
    },
    /** Expirado / revocado */
    red: {
        border: "#FF453A",
        bgDark: "rgba(255, 69, 58, 0.10)",
        bgLight: "rgba(255, 69, 58, 0.06)",
        badge: "#FF453A",
        badgeText: "#FFFFFF",
        label: "Expirado",
        icon: "close-circle" as const,
    },
};

/**
 * Determina el estado visual de la tarjeta.
 * @returns "green" | "amber" | "red"
 */
function getCardState(certificate: Certificate, isActive: boolean): "green" | "amber" | "red" {
    const status = getCertificateStatus(certificate.expirationDate);

    // Si está expirado o en peligro (≤30 días) → rojo
    if (status.color === "danger") return "red";

    // Si está válido y activo → verde
    if (isActive) return "green";

    // Válido pero no activado → ámbar
    return "amber";
}

/**
 * Tarjeta visual de certificado con colores por estado y toggle de activación.
 */
export function CertificateBadge({
    certificate,
    index,
    onDelete,
    isActive = false,
    onToggleActive,
    onVerify,
}: CertificateBadgeProps) {
    const { colors, isDark } = useTheme();
    const status = getCertificateStatus(certificate.expirationDate);
    const cardState = getCardState(certificate, isActive);
    const palette = CARD_COLORS[cardState];
    const isExpired = status.color === "danger";

    /** Manejar el toggle */
    const handleToggle = () => {
        if (isExpired || !onToggleActive) return;
        onToggleActive(!isActive);
    };

    return (
        <Animated.View
            entering={FadeInRight.delay(index * 100).duration(400)}
            style={{ marginBottom: 12 }}
        >
            <View
                style={{
                    backgroundColor: isDark ? palette.bgDark : palette.bgLight,
                    borderRadius: 16,
                    borderWidth: 1.5,
                    borderColor: palette.border,
                    overflow: "hidden",
                }}
            >
                {/* Barra superior de color */}
                <View style={{
                    height: 3,
                    backgroundColor: palette.border,
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                }} />

                <View style={{ padding: 14 }}>
                    {/* Fila 1: Nombre + Badge Estado + Eliminar */}
                    <View style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                    }}>
                        {/* Indicador de punto de estado */}
                        <View style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: palette.border,
                        }} />

                        {/* Nombre del certificado */}
                        <Text
                            style={{
                                color: colors.text,
                                fontSize: 15,
                                fontWeight: "700",
                                flex: 1,
                                letterSpacing: -0.2,
                            }}
                            numberOfLines={1}
                        >
                            {certificate.name}
                        </Text>

                        {/* Badge de estado — pill style */}
                        <View style={{
                            backgroundColor: palette.badge,
                            paddingHorizontal: 9,
                            paddingVertical: 3,
                            borderRadius: 999,
                        }}>
                            <Text style={{
                                color: palette.badgeText,
                                fontSize: 10,
                                fontWeight: "700",
                                letterSpacing: 0.4,
                                textTransform: "uppercase",
                            }}>
                                {palette.label}
                            </Text>
                        </View>

                        {/* Botón eliminar */}
                        {onDelete && (
                            <Pressable
                                onPress={onDelete}
                                hitSlop={8}
                                style={({ pressed }) => ({
                                    opacity: pressed ? 0.5 : 0.8,
                                    padding: 4,
                                })}
                            >
                                <Ionicons name="trash-outline" size={18} color="#FF453A" />
                            </Pressable>
                        )}
                    </View>

                    {/* Fila 2: Tipo + Expiración + Estado, compacto */}
                    <View style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 12,
                        marginTop: 10,
                        paddingLeft: 18,
                    }}>
                        {/* Tipo */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Ionicons
                                name={certificate.type === "distribution" ? "globe-outline" : "code-slash-outline"}
                                size={13}
                                color={colors.textSecondary}
                            />
                            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                                {certificate.type === "distribution" ? "Distribución" : "Desarrollo"}
                            </Text>
                        </View>

                        {/* Separador */}
                        <View style={{
                            width: 1,
                            height: 12,
                            backgroundColor: colors.cardBorder,
                        }} />

                        {/* Expiración */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
                            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                                {formatExpirationDate(certificate.expirationDate)}
                            </Text>
                        </View>

                        {/* Separador */}
                        <View style={{
                            width: 1,
                            height: 12,
                            backgroundColor: colors.cardBorder,
                        }} />

                        {/* Estado de validez */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Ionicons
                                name={
                                    status.color === "success" ? "checkmark-circle"
                                        : status.color === "warning" ? "warning"
                                            : "close-circle"
                                }
                                size={13}
                                color={
                                    status.color === "success" ? "#34C759"
                                        : status.color === "warning" ? "#FFD60A"
                                            : "#FF453A"
                                }
                            />
                            <Text style={{
                                color: status.color === "success" ? "#34C759"
                                    : status.color === "warning" ? "#FFD60A"
                                        : "#FF453A",
                                fontSize: 12,
                                fontWeight: "600",
                            }}>
                                {status.text}
                            </Text>
                        </View>
                    </View>

                    {/* Fila 3: Archivos + Toggle */}
                    <View style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 12,
                        paddingTop: 10,
                        borderTopWidth: 1,
                        borderTopColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                    }}>
                        {/* Archivos asociados */}
                        <View style={{ flex: 1, gap: 2 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Ionicons name="document-outline" size={12} color={colors.textSecondary} />
                                <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>
                                    {certificate.p12FileName}
                                </Text>
                            </View>
                            {certificate.provisionFileName ? (
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                    <Ionicons name="shield-outline" size={12} color={colors.textSecondary} />
                                    <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>
                                        {certificate.provisionFileName}
                                    </Text>
                                </View>
                            ) : null}
                        </View>

                        {/* Botón de Comprobar y Toggle */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            {onVerify && !isExpired && (
                                <Pressable
                                    onPress={onVerify}
                                    style={({ pressed }) => ({
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 4,
                                        backgroundColor: isDark
                                            ? "rgba(255,255,255,0.06)"
                                            : "rgba(0,0,0,0.06)",
                                        paddingHorizontal: 10,
                                        paddingVertical: 7,
                                        borderRadius: 12,
                                        borderWidth: 1,
                                        borderColor: isDark
                                            ? "rgba(255,255,255,0.08)"
                                            : "rgba(0,0,0,0.08)",
                                        opacity: pressed ? 0.7 : 1,
                                    })}
                                >
                                    <Ionicons name="shield-checkmark-outline" size={14} color={colors.textSecondary} />
                                    <Text style={{
                                        color: colors.textSecondary,
                                        fontSize: 12,
                                        fontWeight: "600",
                                    }}>
                                        Verificar
                                    </Text>
                                </Pressable>
                            )}

                            {onToggleActive && (
                                <Pressable
                                    onPress={handleToggle}
                                    disabled={isExpired}
                                    style={({ pressed }) => ({
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 6,
                                        backgroundColor: isExpired
                                            ? (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)")
                                            : isActive
                                                ? "rgba(52,199,89,0.14)"
                                                : isDark
                                                    ? "rgba(255,255,255,0.06)"
                                                    : "rgba(0,0,0,0.06)",
                                        paddingHorizontal: 12,
                                        paddingVertical: 7,
                                        borderRadius: 12,
                                        borderWidth: 1,
                                        borderColor: isExpired
                                            ? "rgba(255,255,255,0.06)"
                                            : isActive
                                                ? "rgba(52,199,89,0.28)"
                                                : isDark
                                                    ? "rgba(255,255,255,0.08)"
                                                    : "rgba(0,0,0,0.08)",
                                        opacity: pressed && !isExpired ? 0.7 : isExpired ? 0.4 : 1,
                                    })}
                                >
                                    <Ionicons
                                        name={isExpired ? "ban-outline" : isActive ? "power" : "power-outline"}
                                        size={14}
                                        color={isExpired ? colors.textSecondary : isActive ? "#34C759" : colors.textSecondary}
                                    />
                                    <Text style={{
                                        color: isExpired ? colors.textSecondary : isActive ? "#34C759" : colors.text,
                                        fontSize: 12,
                                        fontWeight: "600",
                                    }}>
                                        {isExpired ? "No disponible" : isActive ? "Activado" : "Activar"}
                                    </Text>
                                </Pressable>
                            )}
                        </View>
                    </View>
                </View>
            </View>
        </Animated.View>
    );
}
