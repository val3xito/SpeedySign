/**
 * SigningLog.tsx
 * Log visual del proceso de firma con animaciones mejoradas.
 * - Icono giratorio para el paso activo
 * - Bounce de entrada al completarse
 * - Highlight con borde izquierdo para el paso activo
 * - Fade/slide de entrada escalonado por paso
 */

import React, { useEffect } from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
    FadeInLeft,
    FadeIn,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
    withSpring,
    withSequence,
    Easing,
} from "react-native-reanimated";
import { useTheme } from "../hooks/useTheme";

/** Estado posible de cada paso del proceso de firma */
export type StepStatus = "pending" | "active" | "completed" | "error";

/** Interfaz de un paso individual del proceso */
export interface SigningStep {
    id: string;
    label: string;
    status: StepStatus;
    detail?: string;
}

/** Props del componente SigningLog */
interface SigningLogProps {
    steps: SigningStep[];
}

/** Colores por estado */
const STATUS_COLORS = (accentColor: string): Record<StepStatus, string> => ({
    pending:   "#4A4A4A",
    active:    accentColor,
    completed: "#34C759",
    error:     "#FF453A",
});

/** Iconos por estado */
const STATUS_ICONS: Record<StepStatus, string> = {
    pending:   "ellipse-outline",
    active:    "sync-outline",
    completed: "checkmark-circle",
    error:     "close-circle",
};

/** Fila animada individual de cada paso */
function StepRow({
    step,
    index,
    isLast,
}: {
    step: SigningStep;
    index: number;
    isLast: boolean;
}) {
    const { colors } = useTheme();
    const palette = STATUS_COLORS(colors.accent);

    const spinRotation = useSharedValue(0);
    const iconScale    = useSharedValue(1);
    const rowOpacity   = useSharedValue(step.status === "pending" ? 0.45 : 1);
    const bgOpacity    = useSharedValue(step.status === "active" ? 1 : 0);

    useEffect(() => {
        if (step.status === "active") {
            // Girar continuamente
            spinRotation.value = withRepeat(
                withTiming(360, { duration: 1100, easing: Easing.linear }),
                -1,
                false
            );
            rowOpacity.value = withTiming(1, { duration: 250 });
            bgOpacity.value  = withTiming(1, { duration: 300 });

        } else if (step.status === "completed") {
            spinRotation.value = 0;
            // Bounce de confirmación
            iconScale.value = withSequence(
                withSpring(1.25, { damping: 8, stiffness: 400 }),
                withSpring(1,    { damping: 14, stiffness: 350 })
            );
            rowOpacity.value = withTiming(1, { duration: 200 });
            bgOpacity.value  = withTiming(0, { duration: 350 });

        } else if (step.status === "error") {
            spinRotation.value = 0;
            iconScale.value = withSequence(
                withSpring(1.15, { damping: 8, stiffness: 400 }),
                withSpring(1,    { damping: 14, stiffness: 350 })
            );
            rowOpacity.value = withTiming(1);
            bgOpacity.value  = withTiming(0, { duration: 300 });

        } else {
            // pending
            rowOpacity.value = withTiming(0.45, { duration: 300 });
            bgOpacity.value  = withTiming(0, { duration: 300 });
        }
    }, [step.status]);

    const rowStyle = useAnimatedStyle(() => ({
        opacity: rowOpacity.value,
    }));

    const iconStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: iconScale.value },
            { rotate: `${spinRotation.value}deg` },
        ],
    }));

    const bgStyle = useAnimatedStyle(() => ({
        opacity: bgOpacity.value,
    }));

    const iconColor  = palette[step.status];
    const iconName   = STATUS_ICONS[step.status];
    const isActive   = step.status === "active";
    const isError    = step.status === "error";

    return (
        <Animated.View
            entering={FadeInLeft.delay(index * 120).duration(380).springify().damping(18)}
            style={[
                {
                    flexDirection: "row",
                    alignItems: "flex-start",
                    paddingVertical: 10,
                    paddingHorizontal: 10,
                    borderRadius: 12,
                    marginBottom: isLast ? 0 : 4,
                    overflow: "hidden",
                },
                rowStyle,
            ]}
        >
            {/* Fondo activo con borde izquierdo de acento */}
            <Animated.View
                style={[
                    {
                        position: "absolute",
                        top: 0, bottom: 0, left: 0, right: 0,
                        backgroundColor: `${colors.accent}0D`,
                        borderRadius: 12,
                        borderLeftWidth: 2.5,
                        borderLeftColor: colors.accent,
                    },
                    bgStyle,
                ]}
            />

            {/* Icono animado */}
            <Animated.View style={[{ marginRight: 12, marginTop: 1 }, iconStyle]}>
                <Ionicons name={iconName as any} size={18} color={iconColor} />
            </Animated.View>

            {/* Texto del paso */}
            <View style={{ flex: 1 }}>
                <Text
                    style={{
                        color: step.status === "pending" ? colors.textSecondary : colors.text,
                        fontSize: 14,
                        fontWeight: isActive ? "600" : "400",
                        letterSpacing: -0.1,
                    }}
                >
                    {step.label}
                </Text>

                {step.detail && (
                    <Animated.Text
                        key={step.detail}
                        entering={FadeIn.duration(220)}
                        style={{
                            color: isError ? "#FF453A" : colors.textSecondary,
                            fontSize: 12,
                            marginTop: 3,
                            letterSpacing: -0.1,
                        }}
                    >
                        {step.detail}
                    </Animated.Text>
                )}
            </View>
        </Animated.View>
    );
}

/**
 * Log visual del proceso de firma con animaciones por paso.
 */
export function SigningLog({ steps }: SigningLogProps) {
    const { colors } = useTheme();

    return (
        <View
            style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                padding: 14,
                borderWidth: 1,
                borderColor: colors.cardBorder,
            }}
        >
            {/* Título */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Ionicons name="list-outline" size={15} color={colors.textSecondary} />
                <Text
                    style={{
                        color: colors.text,
                        fontSize: 14,
                        fontWeight: "600",
                        letterSpacing: -0.2,
                    }}
                >
                    Registro de firma
                </Text>
            </View>

            {/* Pasos */}
            {steps.map((step, index) => (
                <StepRow
                    key={step.id}
                    step={step}
                    index={index}
                    isLast={index === steps.length - 1}
                />
            ))}
        </View>
    );
}

/**
 * Genera los pasos iniciales del proceso de firma (todos en "pending").
 */
export function getInitialSigningSteps(): SigningStep[] {
    return [
        { id: "download", label: "Descargando IPA...",              status: "pending" },
        { id: "validate", label: "Validando certificado...",         status: "pending" },
        { id: "sign",     label: "Firmando aplicación...",           status: "pending" },
        { id: "install",  label: "Instalando en el dispositivo...",  status: "pending" },
    ];
}
