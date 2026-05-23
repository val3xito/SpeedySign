/**
 * ScrollToTopButton.tsx
 * Liquid glass "scroll to top" button.
 * Positioned center-horizontally above the tab bar.
 */

import React, { useEffect } from "react";
import { Pressable, StyleSheet, Platform, View } from "react-native";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useTheme } from "../hooks/useTheme";

interface ScrollToTopButtonProps {
    visible: boolean;
    onPress: () => void;
    bottomOffset?: number;
}

const BTN_SIZE = 44;

export function ScrollToTopButton({
    visible,
    onPress,
    bottomOffset = 90,
}: ScrollToTopButtonProps) {
    const { colors, isDark } = useTheme();
    const opacity = useSharedValue(0);

    useEffect(() => {
        opacity.value = withTiming(visible ? 1 : 0, { duration: 140 });
    }, [visible]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    return (
        <Animated.View
            style={[
                styles.container,
                { bottom: bottomOffset },
                animatedStyle,
            ]}
            pointerEvents={visible ? "auto" : "none"}
        >
            <Pressable
                onPress={onPress}
                style={({ pressed }) => [
                    styles.button,
                    { opacity: pressed ? 0.75 : 1 },
                ]}
            >
                {/* Glass background */}
                <BlurView
                    intensity={Platform.OS === "ios" ? 60 : 80}
                    tint={isDark ? "dark" : "light"}
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            borderRadius: BTN_SIZE / 2,
                            overflow: "hidden",
                            backgroundColor: isDark
                                ? "rgba(25,25,25,0.50)"
                                : "rgba(250,250,250,0.55)",
                        },
                    ]}
                />
                {/* Specular highlight */}
                <LinearGradient
                    colors={
                        isDark
                            ? [
                                "rgba(255,255,255,0.18)",
                                "rgba(255,255,255,0.04)",
                                "transparent",
                            ]
                            : [
                                "rgba(255,255,255,0.90)",
                                "rgba(255,255,255,0.35)",
                                "transparent",
                            ]
                    }
                    locations={[0, 0.35, 0.8]}
                    style={[StyleSheet.absoluteFill, { borderRadius: BTN_SIZE / 2 }]}
                    pointerEvents="none"
                />
                {/* Glass border */}
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            borderRadius: BTN_SIZE / 2,
                            borderWidth: 1.5,
                            borderColor: isDark
                                ? "rgba(255,255,255,0.14)"
                                : "rgba(255,255,255,0.80)",
                        },
                    ]}
                    pointerEvents="none"
                />
                {/* Arrow icon — red accent */}
                <Ionicons name="arrow-up" size={22} color={colors.accent} />
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: "absolute",
        alignSelf: "center",
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 999,
    },
    button: {
        width: BTN_SIZE,
        height: BTN_SIZE,
        borderRadius: BTN_SIZE / 2,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        // Shadow
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 8,
    },
});
