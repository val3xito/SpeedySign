/**
 * StandaloneTabBar.tsx
 * Tab bar global con todos los efectos LiquidGlass:
 * - Colapso/expansión animado
 * - Animaciones de proximidad por tab (icon scale + label)
 * - Burbuja con 4 capas de glass
 * - PanResponder para swipe entre tabs
 * - Funciona en cualquier pantalla (tabs y stack) usando usePathname/useRouter
 */

import React, { useCallback, useRef, useMemo, useState, useEffect } from "react";
import {
    View,
    Pressable,
    StyleSheet,
    Platform,
    Dimensions,
    PanResponder,
    LayoutChangeEvent,
} from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    useDerivedValue,
    interpolate,
    cancelAnimation,
    SharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, usePathname } from "expo-router";
import { useTheme } from "../hooks/useTheme";
import { useTranslation } from "react-i18next";


const { width: SCREEN_WIDTH } = Dimensions.get("window");

/* ─── Dimensiones ─── */
const BAR_HEIGHT = 56;
const BUBBLE_W = 88;
const BUBBLE_H = 64;
const BUBBLE_RISE = 16;
const BOTTOM_LIFT = 18;
const EXPANDED_WIDTH = Math.min(SCREEN_WIDTH - 32, 340);
const COLLAPSED_WIDTH = 180;

/* ─── Springs ─── */
const BUBBLE_SPRING = { damping: 18, stiffness: 160, mass: 0.6 };
const SNAP_SPRING   = { damping: 22, stiffness: 200, mass: 0.5 };
const EXPAND_SPRING = { damping: 22, stiffness: 180, mass: 0.5 };

/* ─── Tabs ─── */
const TABS = [
    {
        path: "/(tabs)/explore",
        match: ["/explore", "/(tabs)/explore"],
        iconActive:   "compass"         as const,
        iconInactive: "compass-outline" as const,
        labelKey: "tabs.explore" as const,
    },
    {
        path: "/(tabs)/library",
        match: ["/library", "/(tabs)/library"],
        iconActive:   "grid"         as const,
        iconInactive: "grid-outline" as const,
        labelKey: "tabs.library" as const,
    },
    {
        path: "/(tabs)/settings",
        match: ["/settings", "/(tabs)/settings"],
        iconActive:   "settings"         as const,
        iconInactive: "settings-outline" as const,
        labelKey: "tabs.settings" as const,
    },
];

const TAB_COUNT = TABS.length;

/* ─────────────────────────────────────────────
 * TabItem — animated icon + label via proximity
 * ───────────────────────────────────────────── */
interface TabItemProps {
    tabIndex: number;
    accentColor: string;
    inactiveColor: string;
    onPress: () => void;
    proximity: SharedValue<number>;
}

function TabItem({ tabIndex, accentColor, inactiveColor, onPress, proximity }: TabItemProps) {
    const tab = TABS[tabIndex];
    const { t } = useTranslation();

    const iconStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: interpolate(proximity.value, [0, 1], [0, -3]) },
            { scale: interpolate(proximity.value, [0, 1], [1, 1.1]) },
        ],
    }));

    const labelStyle = useAnimatedStyle(() => ({
        opacity: interpolate(proximity.value, [0, 0.5, 1], [0, 0, 1]),
        transform: [
            { translateY: interpolate(proximity.value, [0, 1], [4, 0]) },
            { scale: interpolate(proximity.value, [0, 1], [0.6, 1]) },
        ],
        height: interpolate(proximity.value, [0, 1], [0, 13]),
    }));

    const activeLayer   = useAnimatedStyle(() => ({ opacity: proximity.value }));
    const inactiveLayer = useAnimatedStyle(() => ({ opacity: 1 - proximity.value }));

    return (
        <Pressable onPress={onPress} style={styles.tabItem}>
            <View style={styles.tabContent}>
                <Animated.View style={iconStyle}>
                    <View>
                        <Animated.View style={inactiveLayer}>
                            <Ionicons name={tab.iconInactive} size={23} color={inactiveColor} />
                        </Animated.View>
                        <Animated.View style={[StyleSheet.absoluteFill, activeLayer]}>
                            <Ionicons name={tab.iconActive} size={23} color={accentColor} />
                        </Animated.View>
                    </View>
                </Animated.View>
                <Animated.Text
                    style={[styles.label, labelStyle, { color: accentColor }]}
                    numberOfLines={1}
                >
                    {t(tab.labelKey)}
                </Animated.Text>
            </View>
        </Pressable>
    );
}

/* ─────────────────────────────────────────────
 * StandaloneTabBar
 * ───────────────────────────────────────────── */
export function StandaloneTabBar() {
    const { colors, isDark } = useTheme();
    const router   = useRouter();
    const pathname = usePathname();
    const rnInsets = useSafeAreaInsets();
    // En web, usamos calc(env(safe-area-inset-bottom, 0px) + 18px) para que iOS resuelva
    // dinámicamente el safe area en PWA standalone de forma nativa e instantánea.
    const tabBarBottomOffset = Platform.OS === "web"
        ? "calc(env(safe-area-inset-bottom, 0px) + 18px)" as any
        : rnInsets.bottom + BOTTOM_LIFT;

    /* Índice activo según ruta */
    const activeIndex = useMemo(() => {
        const idx = TABS.findIndex(tab =>
            tab.match.some(m => pathname === m || pathname.startsWith(m))
        );
        return idx >= 0 ? idx : -1;
    }, [pathname]);

    /* Shared values */
    const bubbleX     = useSharedValue(
        activeIndex >= 0
            ? activeIndex * (COLLAPSED_WIDTH / TAB_COUNT) + (COLLAPSED_WIDTH / TAB_COUNT) / 2
            : (COLLAPSED_WIDTH / TAB_COUNT) / 2
    );
    const barWidth    = useSharedValue(COLLAPSED_WIDTH);
    const isExpanded  = useSharedValue(false);
    const isDraggingSV = useSharedValue(false);

    const collapseTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const currentIndexRef  = useRef(activeIndex >= 0 ? activeIndex : 0);
    const lastValidIndex   = useRef(activeIndex >= 0 ? activeIndex : 0);
    if (activeIndex >= 0) {
        currentIndexRef.current = activeIndex;
        lastValidIndex.current  = activeIndex;
    }

    const [layoutDone, setLayoutDone] = useState(false);
    const dragState = useRef({ barWidth: COLLAPSED_WIDTH, initialized: false }).current;

    /* Colapsar */
    const collapseBar = useCallback((targetIndex?: number) => {
        if (collapseTimer.current) clearTimeout(collapseTimer.current);
        collapseTimer.current = setTimeout(() => {
            isExpanded.value = false;
            barWidth.value   = withSpring(COLLAPSED_WIDTH, EXPAND_SPRING);
            const idx  = targetIndex ?? lastValidIndex.current;
            const tabW = COLLAPSED_WIDTH / TAB_COUNT;
            if (idx >= 0) {
                bubbleX.value = withSpring(idx * tabW + tabW / 2, BUBBLE_SPRING);
            }
        }, 300);
    }, []);

    /* Expandir */
    const expandBar = useCallback(() => {
        if (collapseTimer.current) clearTimeout(collapseTimer.current);
        isExpanded.value = true;
        barWidth.value   = withSpring(EXPANDED_WIDTH, EXPAND_SPRING);
        const idx  = currentIndexRef.current;
        const tabW = EXPANDED_WIDTH / TAB_COUNT;
        if (idx >= 0) {
            bubbleX.value = withSpring(idx * tabW + tabW / 2, BUBBLE_SPRING);
        }
    }, []);

    /* Sincronizar bubble cuando cambia la ruta externamente */
    useEffect(() => {
        if (activeIndex < 0) return; // ruta transitoria — no mover la burbuja
        const tabW = isExpanded.value ? EXPANDED_WIDTH / TAB_COUNT : COLLAPSED_WIDTH / TAB_COUNT;
        bubbleX.value = withSpring(activeIndex * tabW + tabW / 2, BUBBLE_SPRING);
    }, [activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    /* Proximidades */
    const twDerived = useDerivedValue(() => barWidth.value / TAB_COUNT);

    const prox0 = useDerivedValue(() => {
        const t = twDerived.value; if (!t) return 0;
        return Math.max(0, 1 - Math.abs(bubbleX.value - (0 * t + t / 2)) / (t * 0.7));
    });
    const prox1 = useDerivedValue(() => {
        const t = twDerived.value; if (!t) return 0;
        return Math.max(0, 1 - Math.abs(bubbleX.value - (1 * t + t / 2)) / (t * 0.7));
    });
    const prox2 = useDerivedValue(() => {
        const t = twDerived.value; if (!t) return 0;
        return Math.max(0, 1 - Math.abs(bubbleX.value - (2 * t + t / 2)) / (t * 0.7));
    });
    const proximities = [prox0, prox1, prox2];

    /* Layout */
    const handleLayout = useCallback((e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        dragState.barWidth = w;
        if (!dragState.initialized) {
            dragState.initialized = true;
            if (activeIndex >= 0) {
                bubbleX.value = activeIndex * (w / TAB_COUNT) + (w / TAB_COUNT) / 2;
            }
            setLayoutDone(true);
        }
    }, [activeIndex]);

    /* Navegar */
    const navigateTo = useCallback((idx: number) => {
        if (idx < 0 || idx >= TAB_COUNT) return;
        // Usamos replace en lugar de push para que iOS Safari standalone
        // use history.replaceState (no crea entrada nueva en el historial)
        // evitando el bug de iOS que rompe el modo standalone con pushState.
        router.replace(TABS[idx].path as any);
    }, [router]);

    /* Tap en tab */
    const handleTabPress = useCallback((index: number) => {
        if (!isExpanded.value) expandBar();

        cancelAnimation(bubbleX);
        const tabW = EXPANDED_WIDTH / TAB_COUNT;
        bubbleX.value = withSpring(index * tabW + tabW / 2, BUBBLE_SPRING);

        navigateTo(index);
        collapseBar(index);
    }, [navigateTo, expandBar, collapseBar]);

    /* PanResponder */
    const panResponder = useMemo(
        () =>
            PanResponder.create({
                onStartShouldSetPanResponder: () => false,
                onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8,
                onPanResponderGrant: () => {
                    isDraggingSV.value = true;
                    cancelAnimation(bubbleX);
                    if (!isExpanded.value) {
                        if (collapseTimer.current) clearTimeout(collapseTimer.current);
                        isExpanded.value = true;
                        barWidth.value   = withSpring(EXPANDED_WIDTH, EXPAND_SPRING);
                    }
                },
                onPanResponderMove: (_, gs) => {
                    const bw   = EXPANDED_WIDTH;
                    const tabW = bw / TAB_COUNT;
                    if (!tabW) return;
                    const screenW         = Dimensions.get("window").width;
                    const wrapperLeftEdge = (screenW - barWidth.value) / 2;
                    const targetX         = gs.moveX - wrapperLeftEdge;
                    bubbleX.value = Math.max(tabW / 2, Math.min(targetX, bw - tabW / 2));
                },
                onPanResponderRelease: () => {
                    isDraggingSV.value = false;
                    const tabW   = EXPANDED_WIDTH / TAB_COUNT;
                    if (!tabW) return;
                    const nearest = Math.round((bubbleX.value - tabW / 2) / tabW);
                    const clamped = Math.max(0, Math.min(nearest, TAB_COUNT - 1));
                    bubbleX.value = withSpring(clamped * tabW + tabW / 2, SNAP_SPRING);
                    navigateTo(clamped);
                    collapseBar(clamped);
                },
                onPanResponderTerminate: () => {
                    isDraggingSV.value = false;
                    const tabW = COLLAPSED_WIDTH / TAB_COUNT;
                    if (tabW > 0 && activeIndex >= 0) {
                        bubbleX.value = withSpring(activeIndex * tabW + tabW / 2, SNAP_SPRING);
                    }
                    collapseBar();
                },
            }),
        [navigateTo, expandBar, collapseBar, activeIndex]
    );

    /* Animated styles */
    const wrapperAnimStyle = useAnimatedStyle(() => ({ width: barWidth.value }));
    const barGlassAnimStyle = useAnimatedStyle(() => ({ width: barWidth.value }));
    const tabsOverlayAnimStyle = useAnimatedStyle(() => ({ width: barWidth.value }));

    const bubbleAnimStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: bubbleX.value - BUBBLE_W / 2 },
            { scaleX: isDraggingSV.value ? 1.06 : 1 },
            { scaleY: isDraggingSV.value ? 0.95 : 1 },
        ],
    }));

    return (
        <View
            style={[
                styles.root,
                { bottom: tabBarBottomOffset },
            ]}
            pointerEvents="box-none"
        >
            <Animated.View style={[styles.wrapper, wrapperAnimStyle, { height: BAR_HEIGHT + BUBBLE_RISE }]}>

                {/* ═══ Layer 1: Bar glass ═══ */}
                <Animated.View style={[styles.barGlass, barGlassAnimStyle]}>
                    <BlurView
                        intensity={Platform.OS === "ios" ? 80 : 100}
                        tint={isDark ? "dark" : "light"}
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                borderRadius: BAR_HEIGHT / 2,
                                overflow: "hidden",
                                backgroundColor: isDark
                                    ? "rgba(20,20,20,0.50)"
                                    : "rgba(245,245,245,0.55)",
                            },
                        ]}
                    />
                    <LinearGradient
                        colors={
                            isDark
                                ? ["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "transparent"]
                                : ["rgba(255,255,255,0.85)", "rgba(255,255,255,0.30)", "transparent"]
                        }
                        locations={[0, 0.3, 1]}
                        style={[StyleSheet.absoluteFill, { borderRadius: BAR_HEIGHT / 2 }]}
                        pointerEvents="none"
                    />
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                borderRadius: BAR_HEIGHT / 2,
                                borderWidth: 1.5,
                                borderColor: isDark
                                    ? "rgba(255,255,255,0.12)"
                                    : "rgba(255,255,255,0.80)",
                            },
                        ]}
                        pointerEvents="none"
                    />
                </Animated.View>

                {/* ═══ Layer 2: Bubble ═══ */}
                {layoutDone && (
                    <Animated.View style={[styles.bubbleOuter, bubbleAnimStyle]} pointerEvents="none">
                        <View style={styles.bubblePill}>
                            <BlurView
                                intensity={Platform.OS === "ios" ? 60 : 80}
                                tint={isDark ? "dark" : "light"}
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        borderRadius: BUBBLE_H / 2,
                                        overflow: "hidden",
                                        backgroundColor: isDark
                                            ? "rgba(30,30,30,0.45)"
                                            : "rgba(255,255,255,0.60)",
                                    },
                                ]}
                            />
                            <LinearGradient
                                colors={
                                    isDark
                                        ? ["rgba(255,255,255,0.20)", "rgba(255,255,255,0.05)", "transparent"]
                                        : ["rgba(255,255,255,0.95)", "rgba(255,255,255,0.45)", "transparent"]
                                }
                                locations={[0, 0.35, 0.75]}
                                style={[StyleSheet.absoluteFill, { borderRadius: BUBBLE_H / 2 }]}
                                pointerEvents="none"
                            />
                            {/* Outer ring */}
                            <View
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        borderRadius: BUBBLE_H / 2,
                                        borderWidth: 2.5,
                                        borderColor: isDark
                                            ? "rgba(255,255,255,0.18)"
                                            : "rgba(255,255,255,0.88)",
                                    },
                                ]}
                                pointerEvents="none"
                            />
                            {/* Inner ring */}
                            <View
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        borderRadius: BUBBLE_H / 2 - 3,
                                        margin: 3,
                                        borderWidth: 1,
                                        borderColor: isDark
                                            ? "rgba(255,255,255,0.07)"
                                            : "rgba(255,255,255,0.5)",
                                    },
                                ]}
                                pointerEvents="none"
                            />
                        </View>
                    </Animated.View>
                )}

                {/* ═══ Layer 3: Tab icons con proximidad ═══ */}
                <Animated.View
                    style={[styles.tabsOverlay, tabsOverlayAnimStyle]}
                    onLayout={handleLayout}
                    {...panResponder.panHandlers}
                >
                    {TABS.map((_, i) => (
                        <TabItem
                            key={i}
                            tabIndex={i}
                            accentColor={colors.accent}
                            inactiveColor={colors.textSecondary}
                            onPress={() => handleTabPress(i)}
                            proximity={proximities[i]}
                        />
                    ))}
                </Animated.View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        position: "absolute",
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 999,
    },
    wrapper: {
        position: "relative",
    },
    barGlass: {
        position: "absolute",
        bottom: 0,
        height: BAR_HEIGHT,
        borderRadius: BAR_HEIGHT / 2,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 24,
        elevation: 20,
        zIndex: 1,
    },
    bubbleOuter: {
        position: "absolute",
        bottom: (BAR_HEIGHT - BUBBLE_H) / 2,
        width: BUBBLE_W,
        height: BUBBLE_H,
        zIndex: 2,
    },
    bubblePill: {
        width: BUBBLE_W,
        height: BUBBLE_H,
        borderRadius: BUBBLE_H / 2,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
        elevation: 10,
    },
    tabsOverlay: {
        position: "absolute",
        bottom: 0,
        height: BAR_HEIGHT,
        flexDirection: "row",
        zIndex: 3,
    },
    tabItem: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    tabContent: {
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
    },
    label: {
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.2,
    },
});
