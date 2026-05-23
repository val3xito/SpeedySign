/**
 * CustomSwitch.tsx
 * Liquid Glass toggle — iOS 26 style.
 * Frosted glass track with glossy spherical thumb.
 */

import React from "react";
import { Pressable, View, Platform, StyleSheet } from "react-native";
import Animated, {
    useAnimatedStyle,
    withSpring,
    useSharedValue,
    interpolate,
    interpolateColor,
} from "react-native-reanimated";
import { useEffect } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../hooks/useTheme";

/** Props del CustomSwitch */
interface CustomSwitchProps {
    value: boolean;
    onValueChange: (newValue: boolean) => void;
    activeTrackColor?: string;
    inactiveTrackColor?: string;
    thumbColor?: string;
    activeThumbColor?: string;
}

const SPRING_CONFIG = {
    damping: 18,
    stiffness: 220,
    mass: 0.4,
};

const TRACK_WIDTH = 50;
const TRACK_HEIGHT = 30;
const THUMB_SIZE = 24;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - 6; // 6 = padding (3 each side)

/**
 * Liquid Glass toggle switch.
 * Frosted glass track + spherical glossy thumb with spring animation.
 */
export function CustomSwitch({
    value,
    onValueChange,
    activeTrackColor,
    inactiveTrackColor,
    thumbColor,
    activeThumbColor,
}: CustomSwitchProps) {
    const { colors, isDark } = useTheme();
    const progress = useSharedValue(value ? 1 : 0);

    const resolvedActiveTrack = activeTrackColor || colors.accent;
    const resolvedInactiveTrack = inactiveTrackColor || (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)");

    useEffect(() => {
        progress.value = withSpring(value ? 1 : 0, SPRING_CONFIG);
    }, [value]);

    // Track background animado
    const trackStyle = useAnimatedStyle(() => {
        const bg = interpolateColor(
            progress.value,
            [0, 1],
            [isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", resolvedActiveTrack]
        );
        const borderClr = interpolateColor(
            progress.value,
            [0, 1],
            [
                isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
                isDark ? "rgba(255,80,80,0.4)" : "rgba(200,40,40,0.3)",
            ]
        );
        return {
            backgroundColor: bg,
            borderColor: borderClr,
        };
    });

    // Thumb position + scale (micro-bounce)
    const thumbStyle = useAnimatedStyle(() => {
        const tx = interpolate(progress.value, [0, 1], [0, THUMB_TRAVEL]);
        const s = interpolate(progress.value, [0, 0.5, 1], [1, 1.08, 1]);
        return {
            transform: [{ translateX: tx }, { scale: s }],
        };
    });

    // Glow detrás del thumb cuando activo
    const glowStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 0.7, 1], [0, 0, 0.4]),
        transform: [
            { translateX: interpolate(progress.value, [0, 1], [0, THUMB_TRAVEL]) },
        ],
    }));

    return (
        <Pressable
            onPress={() => onValueChange(!value)}
            hitSlop={8}
            accessibilityRole="switch"
            accessibilityState={{ checked: value }}
        >
            <Animated.View
                style={[
                    {
                        width: TRACK_WIDTH,
                        height: TRACK_HEIGHT,
                        borderRadius: TRACK_HEIGHT / 2,
                        justifyContent: "center",
                        paddingHorizontal: 3,
                        borderWidth: 1,
                        overflow: "hidden",
                    },
                    trackStyle,
                ]}
            >
                {/* Specular highlight en la parte superior del track */}
                <LinearGradient
                    colors={
                        isDark
                            ? ["rgba(255,255,255,0.08)", "transparent"]
                            : ["rgba(255,255,255,0.5)", "transparent"]
                    }
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: "50%",
                        borderTopLeftRadius: TRACK_HEIGHT / 2,
                        borderTopRightRadius: TRACK_HEIGHT / 2,
                    }}
                    pointerEvents="none"
                />

                {/* Glow del accent detrás del thumb */}
                <Animated.View
                    style={[
                        {
                            position: "absolute",
                            width: THUMB_SIZE + 10,
                            height: THUMB_SIZE + 10,
                            borderRadius: (THUMB_SIZE + 10) / 2,
                            backgroundColor: colors.accent,
                            left: 0,
                            top: (TRACK_HEIGHT - THUMB_SIZE - 10) / 2,
                        },
                        glowStyle,
                    ]}
                    pointerEvents="none"
                />

                {/* Thumb — esfera con highlight */}
                <Animated.View
                    style={[
                        {
                            width: THUMB_SIZE,
                            height: THUMB_SIZE,
                            borderRadius: THUMB_SIZE / 2,
                            backgroundColor: isDark ? "#F0F0F0" : "#FFFFFF",
                            // Shadow
                            shadowColor: "#000",
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: isDark ? 0.5 : 0.2,
                            shadowRadius: 4,
                            elevation: 4,
                            overflow: "hidden",
                        },
                        thumbStyle,
                    ]}
                >
                    {/* Highlight specular del thumb */}
                    <LinearGradient
                        colors={[
                            "rgba(255,255,255,0.9)",
                            "rgba(255,255,255,0.2)",
                            "rgba(0,0,0,0.05)",
                        ]}
                        locations={[0, 0.4, 1]}
                        style={[StyleSheet.absoluteFill, { borderRadius: THUMB_SIZE / 2 }]}
                        pointerEvents="none"
                    />

                    {/* Borde sutil del thumb */}
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                borderRadius: THUMB_SIZE / 2,
                                borderWidth: 0.5,
                                borderColor: isDark
                                    ? "rgba(255,255,255,0.15)"
                                    : "rgba(0,0,0,0.06)",
                            },
                        ]}
                        pointerEvents="none"
                    />
                </Animated.View>
            </Animated.View>
        </Pressable>
    );
}

