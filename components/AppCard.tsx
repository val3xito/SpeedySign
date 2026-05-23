/**
 * AppCard.tsx
 * Componente de tarjeta para mostrar una app del catálogo.
 * Se usa en un grid de 2 columnas (3+ en iPad).
 * Muestra icono, nombre, versión y repositorio de origen.
 */

import React, { useState } from "react";
import { View, Text, Image, Pressable, useWindowDimensions } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../hooks/useTheme";
import { AppItem } from "../constants/defaultRepos";
import { getImgProxyUrl } from "../utils/imgProxy";


/** Props del componente AppCard */
interface AppCardProps {
    app: AppItem;
    index: number;
    onPress: () => void;
    onImageError?: () => void;
    animated?: boolean;
}

/**
 * Tarjeta de aplicación para el grid del catálogo.
 * Incluye animación de entrada escalonada para efecto visual atractivo.
 */
export function AppCard({ app, index, onPress, onImageError, animated = true }: AppCardProps) {
    const { colors } = useTheme();
    const { width } = useWindowDimensions();
    const [imageError, setImageError] = useState(false);

    // Adaptar el ancho según el dispositivo (iPad muestra más columnas)
    const isTablet = width > 768;
    const columns = isTablet ? 3 : 2;
    const cardWidth = (width - 32 - (columns - 1) * 12) / columns;

    return (
        <Animated.View
            entering={animated ? FadeInUp.delay(Math.min(index, 10) * 50).duration(350) : undefined}
            style={{ width: cardWidth, marginBottom: 12 }}
        >
            <Pressable
                onPress={onPress}
                style={({ pressed }) => ({
                    backgroundColor: colors.card,
                    borderRadius: 16,
                    padding: 14,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: pressed
                        ? `${colors.accent}35`
                        : `${colors.accent}12`,
                    opacity: pressed ? 0.82 : 1,
                    shadowColor: colors.accent,
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: pressed ? 0.18 : 0.06,
                    shadowRadius: 8,
                    elevation: pressed ? 4 : 2,
                    transform: [{ translateY: pressed ? 1 : 0 }],
                })}
            >
                {/* Icono de la app */}
                {imageError || !app.icon ? (
                    <View style={{
                        width: 64, height: 64, borderRadius: 14,
                        backgroundColor: colors.cardBorder,
                        marginBottom: 10,
                        justifyContent: 'center', alignItems: 'center',
                    }}>
                        <Ionicons name="apps-outline" size={28} color={colors.textSecondary} />
                    </View>
                ) : (
                    <Image
                        source={{ uri: getImgProxyUrl(app.icon) }}
                        onError={() => {
                            setImageError(true);
                            if (onImageError) onImageError();
                        }}
                        style={{
                            width: 64,
                            height: 64,
                            borderRadius: 14,
                            backgroundColor: colors.cardBorder,
                            marginBottom: 10,
                        }}
                    />
                )}

                {/* Nombre de la app */}
                <Text
                    style={{
                        color: colors.text,
                        fontSize: 14,
                        fontWeight: "600",
                        textAlign: "center",
                        letterSpacing: -0.1,
                    }}
                    numberOfLines={1}
                >
                    {app.name}
                </Text>

                {/* Versión */}
                <Text
                    style={{
                        color: colors.textSecondary,
                        fontSize: 12,
                        marginTop: 3,
                    }}
                    numberOfLines={1}
                >
                    v{app.version}
                </Text>

                {/* Nombre del repositorio de origen y Categoría */}
                {(app.repoName || app.category) && (
                    <View
                        style={{
                            backgroundColor: `${colors.accent}14`,
                            borderRadius: 999,
                            paddingHorizontal: 9,
                            paddingVertical: 3,
                            marginTop: 8,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                            borderWidth: 1,
                            borderColor: `${colors.accent}22`,
                            maxWidth: "100%",
                            overflow: "hidden",
                        }}
                    >
                        {app.category === "jailbreak" && (
                            <Ionicons name="lock-open-outline" size={10} color={colors.accent} style={{ flexShrink: 0 }} />
                        )}
                        {app.category === "sideload" && (
                            <Ionicons name="cube-outline" size={10} color={colors.accent} style={{ flexShrink: 0 }} />
                        )}

                        {app.repoName && (
                            <Text
                                style={{
                                    color: colors.accent,
                                    fontSize: 10,
                                    fontWeight: "600",
                                    flexShrink: 1,
                                }}
                                numberOfLines={1}
                            >
                                {app.repoName}
                            </Text>
                        )}
                    </View>
                )}
            </Pressable>
        </Animated.View>
    );
}
