/**
 * ProgressBar.tsx
 * Barra de progreso animada con brillo pulsante y shimmer.
 * - Relleno suavizado con bezier
 * - Glow que respira mientras el progreso avanza
 * - Shimmer (destello) que barre la barra en bucle
 * - Porcentaje en color acento
 */

import React, { useEffect, useState } from "react";
import { View, Text, LayoutChangeEvent } from "react-native";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withRepeat,
    withSequence,
    Easing,
} from "react-native-reanimated";
import { useTheme } from "../hooks/useTheme";

/** Props del componente ProgressBar */
interface ProgressBarProps {
    progress: number;   // 0 – 100
    label?: string;
    color?: string;
}

/**
 * Barra de progreso con animaciones: fill suave, glow pulsante y shimmer.
 */
export function ProgressBar({ progress, label, color }: ProgressBarProps) {
    const { colors } = useTheme();
    const barColor   = color || colors.accent;
    const isComplete = progress >= 100;

    // Ancho del contenedor para calcular desplazamiento del shimmer
    const [containerWidth, setContainerWidth] = useState(0);

    // Valores animados
    const barWidth     = useSharedValue(0);
    const glowOpacity  = useSharedValue(0);
    const shimmerX     = useSharedValue(-200);

    useEffect(() => {
        // Relleno suave
        barWidth.value = withTiming(progress, {
            duration: 550,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        });

        if (progress > 0 && !isComplete) {
            // Glow que respira
            glowOpacity.value = withRepeat(
                withSequence(
                    withTiming(0.9, { duration: 700 }),
                    withTiming(0.3, { duration: 700 })
                ),
                -1,
                true
            );
            // Shimmer que barre continuamente
            if (containerWidth > 0) {
                shimmerX.value = withRepeat(
                    withTiming(containerWidth + 80, {
                        duration: 1600,
                        easing: Easing.linear,
                    }),
                    -1,
                    false
                );
            }
        } else {
            glowOpacity.value = withTiming(0, { duration: 400 });
            shimmerX.value    = -200;
        }
    }, [progress, containerWidth]);

    const fillStyle = useAnimatedStyle(() => ({
        width: `${barWidth.value}%`,
    }));

    const glowStyle = useAnimatedStyle(() => ({
        shadowOpacity: glowOpacity.value,
    }));

    const shimmerStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: shimmerX.value }],
    }));

    const handleLayout = (e: LayoutChangeEvent) => {
        setContainerWidth(e.nativeEvent.layout.width);
    };

    return (
        <View style={{ marginVertical: 8 }}>
            {/* Etiqueta y porcentaje */}
            {label && (
                <View style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                }}>
                    <Text style={{
                        color: colors.textSecondary,
                        fontSize: 13,
                        fontWeight: "500",
                        letterSpacing: -0.1,
                    }}>
                        {label}
                    </Text>
                    <Text style={{
                        color: isComplete ? "#34C759" : barColor,
                        fontSize: 13,
                        fontWeight: "700",
                        letterSpacing: -0.2,
                    }}>
                        {Math.round(progress)}%
                    </Text>
                </View>
            )}

            {/* Pista de fondo */}
            <View
                onLayout={handleLayout}
                style={{
                    height: 8,
                    backgroundColor: `${barColor}20`,
                    borderRadius: 999,
                    overflow: "hidden",
                }}
            >
                {/* Relleno animado con glow */}
                <Animated.View
                    style={[
                        {
                            height: "100%",
                            backgroundColor: barColor,
                            borderRadius: 999,
                            shadowColor: barColor,
                            shadowOffset: { width: 0, height: 0 },
                            shadowRadius: 8,
                            elevation: 6,
                            overflow: "hidden",
                        },
                        fillStyle,
                        glowStyle,
                    ]}
                >
                    {/* Shimmer sweep */}
                    <Animated.View
                        style={[
                            {
                                position: "absolute",
                                top: 0,
                                bottom: 0,
                                width: 60,
                                backgroundColor: "rgba(255,255,255,0.28)",
                                borderRadius: 999,
                                transform: [{ skewX: "-20deg" }],
                            },
                            shimmerStyle,
                        ]}
                    />

                    {/* Highlight superior fijo */}
                    <View
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 3,
                            backgroundColor: "rgba(255,255,255,0.18)",
                            borderRadius: 999,
                        }}
                    />
                </Animated.View>
            </View>
        </View>
    );
}
