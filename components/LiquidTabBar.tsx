import React, { useCallback, useRef, useMemo, useState, useEffect } from "react";
import {
    View,
    StyleSheet,
    LayoutChangeEvent,
    Pressable,
    Platform,
    Dimensions,
    PanResponder,
} from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import Animated, {
    useAnimatedStyle,
    withSpring,
    withTiming,
    useSharedValue,
    useDerivedValue,
    interpolate,
    cancelAnimation,
    SharedValue,
    Easing,
    runOnJS,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useTheme } from "../hooks/useTheme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const BUBBLE_SPRING = { damping: 18, stiffness: 160, mass: 0.6 };
const SNAP_SPRING = { damping: 22, stiffness: 200, mass: 0.5 };

const BAR_HEIGHT = 56;
const BUBBLE_W = 88;
const BUBBLE_H = 64;
const BUBBLE_RISE = 16;

/* ─── Collapsed / Expanded dimensions ─── */
const EXPANDED_WIDTH = Math.min(SCREEN_WIDTH - 32, 420);
const COLLAPSED_WIDTH = 180; // Compact: just icons
const COLLAPSE_DELAY = 3000; // Auto-collapse after 3s of inactivity
const EXPAND_SPRING = { damping: 22, stiffness: 180, mass: 0.5 };

/* ─────────────────────────────────────────────
 * TabItem
 * ───────────────────────────────────────────── */
interface TabItemProps {
    title: string;
    accentColor: string;
    inactiveColor: string;
    icon: (props: { focused: boolean; color: string; size: number }) => React.ReactNode;
    onPress: () => void;
    proximity: SharedValue<number>;
}

function TabItem({ title, accentColor, inactiveColor, icon, onPress, proximity }: TabItemProps) {
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

    const activeLayer = useAnimatedStyle(() => ({ opacity: proximity.value }));
    const inactiveLayer = useAnimatedStyle(() => ({ opacity: 1 - proximity.value }));

    return (
        <Pressable onPress={onPress} style={styles.tabItem}>
            <View style={styles.tabContent}>
                <Animated.View style={iconStyle}>
                    <View>
                        <Animated.View style={inactiveLayer}>
                            {icon({ focused: false, color: inactiveColor, size: 23 })}
                        </Animated.View>
                        <Animated.View style={[StyleSheet.absoluteFill, activeLayer]}>
                            {icon({ focused: true, color: accentColor, size: 23 })}
                        </Animated.View>
                    </View>
                </Animated.View>
                <Animated.Text
                    style={[styles.label, labelStyle, { color: accentColor }]}
                    numberOfLines={1}
                >
                    {title}
                </Animated.Text>
            </View>
        </Pressable>
    );
}

/* ─────────────────────────────────────────────
 * LiquidTabBar
 *
 * Collapsible: starts narrow, expands on tap,
 * auto-collapses after inactivity.
 * ───────────────────────────────────────────── */
export function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
    const { colors, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const bubbleX = useSharedValue(0);
    const isDraggingSV = useSharedValue(false);

    // ═══ Expand / Collapse state ═══
    const barWidth = useSharedValue(COLLAPSED_WIDTH);
    const isExpanded = useSharedValue(false);
    const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // JS-thread state for PanResponder (fast, no re-render)
    const dragState = useRef({
        startX: 0,
        barWidth: 0,
        initialized: false,
    }).current;
    const [layoutDone, setLayoutDone] = useState(false);

    // Filtrar rutas visibles (excluir tabs ocultos sin tabBarIcon)
    const visibleRoutes = state.routes.filter(route => {
        const { options } = descriptors[route.key];
        return typeof options.tabBarIcon === 'function';
    });
    const tabCount = visibleRoutes.length;

    // Índice activo dentro de las rutas visibles
    const activeIndex = Math.max(
        0,
        visibleRoutes.findIndex(r => r.key === state.routes[state.index]?.key)
    );

    // Ref que siempre tiene el index actual (evita stale closures en timers)
    const currentIndexRef = useRef(activeIndex);
    currentIndexRef.current = activeIndex;

    // ═══ Colapsar inmediatamente ═══
    const collapseBar = useCallback((targetIndex?: number) => {
        if (collapseTimer.current) clearTimeout(collapseTimer.current);
        // Pequeño delay para que se vea la transición del bubble al tab correcto
        collapseTimer.current = setTimeout(() => {
            isExpanded.value = false;
            barWidth.value = withSpring(COLLAPSED_WIDTH, EXPAND_SPRING);
            const idx = targetIndex ?? currentIndexRef.current;
            const tabW = COLLAPSED_WIDTH / tabCount;
            bubbleX.value = withSpring(idx * tabW + tabW / 2, BUBBLE_SPRING);
        }, 300);
    }, [tabCount]);

    const expandBar = useCallback(() => {
        if (collapseTimer.current) clearTimeout(collapseTimer.current);
        isExpanded.value = true;
        barWidth.value = withSpring(EXPANDED_WIDTH, EXPAND_SPRING);
        const idx = currentIndexRef.current;
        const tabW = EXPANDED_WIDTH / tabCount;
        bubbleX.value = withSpring(idx * tabW + tabW / 2, BUBBLE_SPRING);
    }, [tabCount]);

    // Start collapsed → auto-position bubble
    useEffect(() => {
        const tabW = COLLAPSED_WIDTH / tabCount;
        bubbleX.value = activeIndex * tabW + tabW / 2;
    }, []);

    // ═══ Proximity per tab ═══
    const tw = useSharedValue(COLLAPSED_WIDTH / tabCount);

    // Keep tw in sync with barWidth
    const twDerived = useDerivedValue(() => barWidth.value / tabCount);

    const prox0 = useDerivedValue(() => {
        const t = twDerived.value;
        if (t === 0) return 0;
        return Math.max(0, 1 - Math.abs(bubbleX.value - (0 * t + t / 2)) / (t * 0.7));
    });
    const prox1 = useDerivedValue(() => {
        const t = twDerived.value;
        if (t === 0) return 0;
        return Math.max(0, 1 - Math.abs(bubbleX.value - (1 * t + t / 2)) / (t * 0.7));
    });
    const prox2 = useDerivedValue(() => {
        const t = twDerived.value;
        if (t === 0) return 0;
        return Math.max(0, 1 - Math.abs(bubbleX.value - (2 * t + t / 2)) / (t * 0.7));
    });
    const prox3 = useDerivedValue(() => {
        const t = twDerived.value;
        if (t === 0) return 0;
        return Math.max(0, 1 - Math.abs(bubbleX.value - (3 * t + t / 2)) / (t * 0.7));
    });
    const prox4 = useDerivedValue(() => {
        const t = twDerived.value;
        if (t === 0) return 0;
        return Math.max(0, 1 - Math.abs(bubbleX.value - (4 * t + t / 2)) / (t * 0.7));
    });
    const proximities = [prox0, prox1, prox2, prox3, prox4];

    // ═══ Layout ═══
    const handleLayout = useCallback((e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        dragState.barWidth = w;
        tw.value = w / tabCount;

        if (!dragState.initialized) {
            dragState.initialized = true;
            bubbleX.value = activeIndex * (w / tabCount) + (w / tabCount) / 2;
            setLayoutDone(true);
        }
    }, [tabCount]);

    // ═══ Navigate helper (pure JS, synchronous) ═══
    const navigateTo = useCallback((idx: number) => {
        if (idx < 0 || idx >= visibleRoutes.length) return;
        const route = visibleRoutes[idx];
        if (idx !== activeIndex) {
            navigation.navigate(route.name, route.params);
        }
    }, [visibleRoutes, activeIndex, navigation]);

    // ═══ Tab tap ═══
    const handleTabPress = useCallback((index: number) => {
        const route = visibleRoutes[index];
        if (!route) return;

        // Si está colapsada, expandir primero
        if (!isExpanded.value) {
            expandBar();
        }

        cancelAnimation(bubbleX);
        const tabW = EXPANDED_WIDTH / tabCount;
        bubbleX.value = withSpring(index * tabW + tabW / 2, BUBBLE_SPRING);

        if (index !== activeIndex) {
            const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
            });
            if (!event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
            }
        }

        // Colapsar enseguida después de tocar
        collapseBar(index);
    }, [visibleRoutes, activeIndex, navigation, expandBar, collapseBar, tabCount]);

    // ═══ PanResponder — runs entirely on JS thread ═══
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
                        // Animate width to expanded
                        barWidth.value = withSpring(EXPANDED_WIDTH, EXPAND_SPRING);
                    }
                },
                onPanResponderMove: (_, gs) => {
                    const bw = EXPANDED_WIDTH;
                    const tabW = bw / tabCount;
                    if (tabW === 0) return;
                    
                    // gs.moveX es la posición absoluta del dedo en la pantalla.
                    // El contenedor está centrado, por lo que su borde izquierdo se mueve dinámicamente:
                    const screenW = Dimensions.get("window").width;
                    const wrapperLeftEdge = (screenW - barWidth.value) / 2;
                    
                    // Calculamos targetX asegurando que el bubble siga exacto al dedo
                    const targetX = gs.moveX - wrapperLeftEdge;
                    
                    bubbleX.value = Math.max(tabW / 2, Math.min(targetX, bw - tabW / 2));
                },
                onPanResponderRelease: () => {
                    isDraggingSV.value = false;
                    const bw = EXPANDED_WIDTH;
                    const tabW = bw / tabCount;
                    if (tabW === 0) return;

                    const nearest = Math.round((bubbleX.value - tabW / 2) / tabW);
                    const clamped = Math.max(0, Math.min(nearest, tabCount - 1));
                    const snapX = clamped * tabW + tabW / 2;

                    bubbleX.value = withSpring(snapX, SNAP_SPRING);
                    navigateTo(clamped);
                    // Colapsar enseguida al soltar
                    collapseBar(clamped);
                },
                onPanResponderTerminate: () => {
                    isDraggingSV.value = false;
                    const tabW = EXPANDED_WIDTH / tabCount;
                    if (tabW > 0) {
                        const snapX = activeIndex * tabW + tabW / 2;
                        bubbleX.value = withSpring(snapX, SNAP_SPRING);
                    }
                    collapseBar();
                },
            }),
        [tabCount, navigateTo, expandBar, collapseBar]
    );

    // ═══ Animated styles ═══
    const wrapperAnimStyle = useAnimatedStyle(() => ({
        width: barWidth.value,
    }));

    const barGlassAnimStyle = useAnimatedStyle(() => ({
        width: barWidth.value,
    }));

    const tabsOverlayAnimStyle = useAnimatedStyle(() => ({
        width: barWidth.value,
    }));

    // ═══ Bubble style ═══
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
                {
                    bottom: Platform.OS === "ios"
                        ? insets.bottom
                        : insets.bottom + 12,
                },
            ]}
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
                                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.80)",
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
                            <View
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        borderRadius: BUBBLE_H / 2,
                                        borderWidth: 2.5,
                                        borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.88)",
                                    },
                                ]}
                                pointerEvents="none"
                            />
                            <View
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        borderRadius: BUBBLE_H / 2 - 3,
                                        margin: 3,
                                        borderWidth: 1,
                                        borderColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.5)",
                                    },
                                ]}
                                pointerEvents="none"
                            />
                        </View>
                    </Animated.View>
                )}

                {/* ═══ Layer 3: Touch area + Tabs ═══ */}
                <Animated.View
                    style={[styles.tabsOverlay, tabsOverlayAnimStyle]}
                    onLayout={handleLayout}
                    {...panResponder.panHandlers}
                >
                    {visibleRoutes.map((route, index) => {
                        const { options } = descriptors[route.key];
                        return (
                            <TabItem
                                key={route.key}
                                title={options.title ?? route.name}
                                accentColor={colors.accent}
                                inactiveColor={colors.textSecondary}
                                icon={options.tabBarIcon as any}
                                onPress={() => handleTabPress(index)}
                                proximity={proximities[index]}
                            />
                        );
                    })}
                </Animated.View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { position: "absolute", left: 0, right: 0, alignItems: "center" },
    wrapper: { position: "relative" },
    barGlass: {
        position: "absolute", bottom: 0, height: BAR_HEIGHT,
        borderRadius: BAR_HEIGHT / 2, overflow: "hidden",
        shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25, shadowRadius: 24, elevation: 20, zIndex: 1,
    },
    bubbleOuter: {
        position: "absolute", bottom: (BAR_HEIGHT - BUBBLE_H) / 2,
        width: BUBBLE_W, height: BUBBLE_H, zIndex: 2,
    },
    bubblePill: {
        width: BUBBLE_W, height: BUBBLE_H, borderRadius: BUBBLE_H / 2,
        overflow: "hidden", shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18,
        shadowRadius: 12, elevation: 10,
    },
    tabsOverlay: {
        position: "absolute", bottom: 0, height: BAR_HEIGHT,
        flexDirection: "row", zIndex: 3,
    },
    tabItem: { flex: 1, alignItems: "center", justifyContent: "center" },
    tabContent: { alignItems: "center", justifyContent: "center", gap: 1 },
    label: { fontSize: 9, fontWeight: "700", letterSpacing: 0.2 },
});
