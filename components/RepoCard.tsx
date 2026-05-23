import React, { useRef, useCallback, useState } from "react";
import {
    View, Text, Image, TouchableOpacity, Pressable,
    Platform, Modal, TouchableWithoutFeedback,
} from "react-native";
import { CustomSwitch } from "./CustomSwitch";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTheme } from "../hooks/useTheme";
import { Repo } from "../constants/defaultRepos";
import { getImgProxyUrl } from "../utils/imgProxy";

interface RepoCardProps {
    repo: Repo;
    index: number;
    onPress: () => void;
    onToggle: () => void;
    onDelete?: () => void;
    onEdit?: () => void;
}

/**
 * Tarjeta de repositorio con menú de tres puntos para editar/eliminar.
 */
export function RepoCard({ repo, index, onPress, onToggle, onDelete, onEdit }: RepoCardProps) {
    const { colors } = useTheme();
    const [imageError, setImageError] = useState(false);

    return (
        <Animated.View
            entering={FadeInDown.delay(Math.min(index, 10) * 50).duration(400)}
            style={{ marginBottom: 12 }}
        >
            <Pressable
                onPress={onPress}
                style={({ pressed }) => ({
                    backgroundColor: colors.card,
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    borderRadius: 16,
                    opacity: pressed ? 0.85 : 1,
                    // @ts-ignore web only
                    cursor: 'pointer',
                })}
            >
                {/* Icono del repo */}
                {imageError ? (
                    <View style={{
                        width: 48, height: 48, borderRadius: 12,
                        backgroundColor: colors.cardBorder,
                        justifyContent: 'center', alignItems: 'center',
                    }}>
                        <Ionicons name="cube-outline" size={24} color={colors.textSecondary} />
                    </View>
                ) : (
                    <Image
                        source={{ uri: getImgProxyUrl(repo.icon || "https://img.icons8.com/fluency/96/box.png") }}
                        onError={() => setImageError(true)}
                        style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: colors.cardBorder }}
                    />
                )}

                {/* Texto */}
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text
                        style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}
                        numberOfLines={1}
                    >
                        {repo.name}
                    </Text>
                    <Text
                        style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}
                        numberOfLines={2}
                    >
                        {repo.description}
                    </Text>
                </View>

                {/* Toggle */}
                <Pressable
                    onPress={(e) => { e.stopPropagation?.(); onToggle(); }}
                    hitSlop={8}
                >
                    <CustomSwitch value={repo.enabled} onValueChange={() => onToggle()} />
                </Pressable>

                {/* Menú tres puntos */}
                {(onEdit || onDelete) && (
                    <ThreeDotMenu
                        colors={colors}
                        onEdit={onEdit}
                        onDelete={onDelete}
                    />
                )}
            </Pressable>
        </Animated.View>
    );
}

/* ─── Menú de tres puntos ─── */
function ThreeDotMenu({
    colors,
    onEdit,
    onDelete,
}: {
    colors: any;
    onEdit?: () => void;
    onDelete?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<View>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

    const openMenu = (e: any) => {
        e.stopPropagation?.();
        if (Platform.OS === 'web') {
            // En web medimos la posición del botón para anclar el dropdown
            buttonRef.current?.measureInWindow((x, y, w, h) => {
                setMenuPos({ top: y + h + 4, right: window.innerWidth - x - w });
            });
        }
        setOpen(true);
    };

    const close = () => setOpen(false);

    const handleEdit = (e: any) => {
        e.stopPropagation?.();
        close();
        onEdit?.();
    };

    const handleDelete = (e: any) => {
        e.stopPropagation?.();
        close();
        onDelete?.();
    };

    return (
        <View ref={buttonRef} style={{ marginLeft: 8 }}>
            <Pressable
                onPress={openMenu}
                hitSlop={8}
                style={({ pressed }) => ({
                    width: 32, height: 32, borderRadius: 16,
                    backgroundColor: pressed ? `${colors.cardBorder}` : 'transparent',
                    justifyContent: 'center', alignItems: 'center',
                })}
            >
                <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
            </Pressable>

            <Modal
                visible={open}
                transparent
                animationType="fade"
                onRequestClose={close}
            >
                <TouchableWithoutFeedback onPress={close}>
                    <View style={{ flex: 1 }}>
                        <MenuDropdown
                            colors={colors}
                            onEdit={onEdit ? handleEdit : undefined}
                            onDelete={onDelete ? handleDelete : undefined}
                            webPos={menuPos}
                        />
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </View>
    );
}

/* ─── Dropdown del menú ─── */
function MenuDropdown({
    colors,
    onEdit,
    onDelete,
    webPos,
}: {
    colors: any;
    onEdit?: (e: any) => void;
    onDelete?: (e: any) => void;
    webPos: { top: number; right: number } | null;
}) {
    const isWeb = Platform.OS === 'web';

    const containerStyle: any = isWeb && webPos
        ? {
            position: 'absolute' as const,
            top: webPos.top,
            right: webPos.right,
        }
        : {
            // Native: centrado en pantalla con un card flotante
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)',
        };

    const menuStyle: any = {
        backgroundColor: colors.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 10,
        minWidth: 160,
        overflow: 'hidden',
    };

    const menu = (
        <View style={menuStyle}>
            {onEdit && (
                <Pressable
                    onPress={onEdit}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        backgroundColor: pressed ? `${colors.cardBorder}` : 'transparent',
                        borderBottomWidth: onDelete ? 1 : 0,
                        borderBottomColor: colors.cardBorder,
                    })}
                >
                    <Ionicons name="pencil-outline" size={18} color="#FF9500" />
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }}>
                        Editar
                    </Text>
                </Pressable>
            )}
            {onDelete && (
                <Pressable
                    onPress={onDelete}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        backgroundColor: pressed ? `${'#FF3B30'}18` : 'transparent',
                    })}
                >
                    <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                    <Text style={{ color: '#FF3B30', fontSize: 15, fontWeight: '500' }}>
                        Eliminar
                    </Text>
                </Pressable>
            )}
        </View>
    );

    if (!isWeb) {
        // Native: panel centrado sobre fondo oscuro semitransparente
        return (
            <View style={containerStyle}>
                <TouchableWithoutFeedback>
                    {menu}
                </TouchableWithoutFeedback>
            </View>
        );
    }

    // Web: dropdown anclado bajo el botón
    return (
        <View style={containerStyle}>
            {menu}
        </View>
    );
}
