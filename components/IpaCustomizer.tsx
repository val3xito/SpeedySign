/**
 * IpaCustomizer.tsx
 * Panel colapsable de personalización pre-firma.
 * Permite al usuario modificar Bundle ID, nombre, versión,
 * inyectar dylibs y activar tweaks del Info.plist antes de firmar.
 */

import React, { useState, useCallback } from "react";
import {
    View,
    Text,
    Pressable,
    TextInput,
    Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
    FadeInDown,
    useAnimatedStyle,
    withTiming,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";
import { useTheme } from "../hooks/useTheme";

export interface IpaCustomOptions {
    customBundleId?:          string;
    customName?:              string;
    customVersion?:           string;
    enableFileSharing:        boolean;
    removeDeviceRestrictions: boolean;
    liquidGlass:              boolean;
    sha256Only:               boolean;
    compressionLevel:         number;
    dylibFiles:               File[];
}

export const defaultIpaOptions = (): IpaCustomOptions => ({
    customBundleId: "",
    customName: "",
    customVersion: "",
    enableFileSharing: false,
    removeDeviceRestrictions: false,
    liquidGlass: false,
    sha256Only: false,
    compressionLevel: 1,
    dylibFiles: [],
});

// ── Sub-componentes ─────────────────────────────────────────────────────────────

function SectionHeader({ title, icon }: { title: string; icon: string }) {
    const { colors } = useTheme();
    return (
        <View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginBottom: 12,
            marginTop: 20,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.cardBorder,
        }}>
            <Ionicons name={icon as any} size={13} color={colors.accent} />
            <Text style={{
                color: colors.accent,
                fontSize: 10,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1.2,
            }}>
                {title}
            </Text>
        </View>
    );
}

function FieldInput({
    label, value, onChangeText, placeholder, keyboardType,
}: {
    label: string;
    value: string;
    onChangeText: (t: string) => void;
    placeholder?: string;
    keyboardType?: any;
}) {
    const { colors } = useTheme();
    const [focused, setFocused] = useState(false);

    return (
        <View style={{ marginBottom: 12 }}>
            <Text style={{
                color: colors.textSecondary,
                fontSize: 12,
                fontWeight: "500",
                marginBottom: 6,
            }}>
                {label}
            </Text>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={colors.textSecondary + "55"}
                keyboardType={keyboardType}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: focused ? `${colors.accent}70` : colors.cardBorder,
                    paddingHorizontal: 14,
                    paddingVertical: 11,
                    color: colors.text,
                    fontSize: 13,
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    // @ts-ignore
                    outlineStyle: "none" as any,
                    shadowColor: focused ? colors.accent : "transparent",
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: focused ? 0.25 : 0,
                    shadowRadius: 8,
                }}
            />
        </View>
    );
}

function Toggle({
    label, subtitle, value, onToggle, icon,
}: {
    label: string;
    subtitle?: string;
    value: boolean;
    onToggle: () => void;
    icon?: string;
}) {
    const { colors } = useTheme();
    return (
        <Pressable
            onPress={onToggle}
            style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 11,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: value
                    ? `${colors.accent}12`
                    : `${colors.background}`,
                borderWidth: 1,
                borderColor: value ? `${colors.accent}45` : colors.cardBorder,
                marginBottom: 8,
                opacity: pressed ? 0.75 : 1,
            })}
        >
            {icon && (
                <View style={{
                    width: 32, height: 32, borderRadius: 9,
                    backgroundColor: value
                        ? `${colors.accent}22`
                        : colors.cardBorder + "80",
                    justifyContent: "center",
                    alignItems: "center",
                    marginRight: 12,
                }}>
                    <Ionicons
                        name={icon as any}
                        size={16}
                        color={value ? colors.accent : colors.textSecondary}
                    />
                </View>
            )}
            <View style={{ flex: 1 }}>
                <Text style={{
                    color: colors.text,
                    fontSize: 14,
                    fontWeight: "600",
                }}>
                    {label}
                </Text>
                {subtitle && (
                    <Text style={{
                        color: colors.textSecondary,
                        fontSize: 11,
                        marginTop: 2,
                    }}>
                        {subtitle}
                    </Text>
                )}
            </View>

            {/* Toggle pill */}
            <View style={{
                width: 44,
                height: 24,
                borderRadius: 999,
                backgroundColor: value ? colors.accent : colors.cardBorder,
                justifyContent: "center",
                paddingHorizontal: 3,
                alignItems: value ? "flex-end" : "flex-start",
            }}>
                <View style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    backgroundColor: "#ffffff",
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.2,
                    shadowRadius: 2,
                    elevation: 2,
                }} />
            </View>
        </Pressable>
    );
}

function CompressionSlider({
    value, onChange,
}: { value: number; onChange: (n: number) => void }) {
    const { colors } = useTheme();
    const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const label = value === 0
        ? "Sin compresión (más rápido)"
        : value <= 3 ? "Baja"
        : value <= 6 ? "Media"
        : "Alta (más lento)";

    return (
        <View style={{ marginBottom: 4 }}>
            <View style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
            }}>
                <Text style={{
                    color: colors.textSecondary,
                    fontSize: 12,
                    fontWeight: "500",
                }}>
                    Compresión ZIP
                </Text>
                <View style={{
                    backgroundColor: `${colors.accent}18`,
                    paddingHorizontal: 9,
                    paddingVertical: 3,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: `${colors.accent}30`,
                }}>
                    <Text style={{
                        color: colors.accent,
                        fontSize: 11,
                        fontWeight: "700",
                    }}>
                        {label}
                    </Text>
                </View>
            </View>
            <View style={{
                flexDirection: "row",
                gap: 5,
                backgroundColor: colors.background,
                borderRadius: 12,
                padding: 6,
                borderWidth: 1,
                borderColor: colors.cardBorder,
            }}>
                {levels.map(l => (
                    <Pressable
                        key={l}
                        onPress={() => onChange(l)}
                        style={({ pressed }) => ({
                            flex: 1,
                            height: 30,
                            borderRadius: 8,
                            backgroundColor: l <= value
                                ? l === value ? colors.accent : `${colors.accent}70`
                                : colors.cardBorder + "60",
                            justifyContent: "center",
                            alignItems: "center",
                            opacity: pressed ? 0.8 : 1,
                        })}
                    >
                        <Text style={{
                            color: l <= value ? "#fff" : colors.textSecondary,
                            fontSize: 10,
                            fontWeight: "700",
                        }}>
                            {l}
                        </Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
    options: IpaCustomOptions;
    onChange: (opts: IpaCustomOptions) => void;
    ipaInfo?: {
        bundleId: string;
        displayName: string;
        shortVersion: string;
    };
}

export function IpaCustomizer({ options, onChange, ipaInfo }: Props) {
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);
    const [dylibs, setDylibs] = useState<string[]>([]);

    const set = useCallback(<K extends keyof IpaCustomOptions>(key: K, val: IpaCustomOptions[K]) => {
        onChange({ ...options, [key]: val });
    }, [options, onChange]);

    const toggle = useCallback((key: "enableFileSharing" | "removeDeviceRestrictions" | "liquidGlass" | "sha256Only") => {
        onChange({ ...options, [key]: !options[key] });
    }, [options, onChange]);

    const activeCount = [
        options.customBundleId, options.customName, options.customVersion,
        options.enableFileSharing, options.removeDeviceRestrictions,
        options.liquidGlass, options.sha256Only,
        options.dylibFiles.length > 0,
    ].filter(Boolean).length;

    return (
        <Animated.View
            entering={FadeInDown.delay(350).duration(350)}
            style={{ marginBottom: 20 }}
        >
            {/*
             * Único contenedor card con overflow:hidden.
             * Esto evita el efecto "cortado" al expandir:
             * el borde y el radio se aplican desde fuera,
             * y el contenido crece dentro sin crear costuras.
             */}
            <View style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: open ? `${colors.accent}45` : colors.cardBorder,
                overflow: "hidden",
            }}>
                {/* ── Header colapsable (BLOQUEADO TEMPORALMENTE) ── */}
                <Pressable
                    onPress={() => {}} // Bloqueado
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 16,
                        backgroundColor: "transparent",
                        opacity: 0.6,
                    }}
                >
                    <View style={{
                        width: 38,
                        height: 38,
                        borderRadius: 11,
                        backgroundColor: `${colors.accent}18`,
                        justifyContent: "center",
                        alignItems: "center",
                        marginRight: 12,
                    }}>
                        <Ionicons name="construct-outline" size={19} color={colors.accent} />
                    </View>

                    <View style={{ flex: 1 }}>
                        <Text style={{
                            color: colors.text,
                            fontSize: 15,
                            fontWeight: "600",
                            letterSpacing: -0.1,
                        }}>
                            Personalizar IPA
                        </Text>
                        <Text style={{
                            color: colors.accent,
                            fontSize: 12,
                            marginTop: 2,
                            fontWeight: "600",
                        }}>
                            🚀 Próximamente
                        </Text>
                    </View>

                    <Ionicons
                        name="lock-closed"
                        size={18}
                        color={colors.textSecondary}
                    />
                </Pressable>

                {/* ── Panel expandido (sin border propio, hereda del wrapper) ── */}
                {open && (
                    <Animated.View
                        entering={FadeInDown.duration(220)}
                        style={{
                            padding: 16,
                            paddingTop: 4,
                            borderTopWidth: 1,
                            borderTopColor: `${colors.accent}25`,
                        }}
                    >
                        {/* ── Identidad ── */}
                        <SectionHeader title="Identidad de la App" icon="finger-print-outline" />

                        <FieldInput
                            label="Bundle ID personalizado"
                            value={options.customBundleId || ""}
                            onChangeText={v => set("customBundleId", v)}
                            placeholder={ipaInfo?.bundleId || "com.example.app"}
                        />
                        <FieldInput
                            label="Nombre visible"
                            value={options.customName || ""}
                            onChangeText={v => set("customName", v)}
                            placeholder={ipaInfo?.displayName || "Mi App"}
                        />
                        <FieldInput
                            label="Versión"
                            value={options.customVersion || ""}
                            onChangeText={v => set("customVersion", v)}
                            placeholder={ipaInfo?.shortVersion || "1.0.0"}
                            keyboardType="decimal-pad"
                        />

                        {/* ── Tweaks iOS ── */}
                        <SectionHeader title="Tweaks de iOS" icon="phone-portrait-outline" />

                        <Toggle
                            icon="folder-open-outline"
                            label="Compartir archivos"
                            subtitle="UIFileSharingEnabled + Archivos.app"
                            value={options.enableFileSharing}
                            onToggle={() => toggle("enableFileSharing")}
                        />
                        <Toggle
                            icon="phone-portrait-outline"
                            label="Eliminar restricciones de dispositivo"
                            subtitle="Elimina UISupportedDevices del plist"
                            value={options.removeDeviceRestrictions}
                            onToggle={() => toggle("removeDeviceRestrictions")}
                        />
                        <Toggle
                            icon="sparkles-outline"
                            label="Forzar iOS 26 Liquid Glass"
                            subtitle="UIDesignRequiresCompatibility = false"
                            value={options.liquidGlass}
                            onToggle={() => toggle("liquidGlass")}
                        />

                        {/* ── Avanzado ── */}
                        <SectionHeader title="Avanzado" icon="settings-outline" />

                        <Toggle
                            icon="shield-checkmark-outline"
                            label="SHA-256 Only"
                            subtitle="Máxima compatibilidad con dispositivos modernos"
                            value={options.sha256Only}
                            onToggle={() => toggle("sha256Only")}
                        />

                        <View style={{ marginTop: 8 }}>
                            <CompressionSlider
                                value={options.compressionLevel}
                                onChange={v => set("compressionLevel", v)}
                            />
                        </View>

                        {/* ── Dylib Injection ── */}
                        <SectionHeader title="Inyección de Dylibs" icon="code-slash-outline" />

                        {Platform.OS === "web" ? (
                            <View>
                                <Pressable
                                    style={({ pressed }) => ({
                                        borderWidth: 1.5,
                                        borderStyle: "dashed",
                                        borderColor: `${colors.accent}50`,
                                        borderRadius: 12,
                                        padding: 20,
                                        alignItems: "center",
                                        gap: 6,
                                        opacity: pressed ? 0.7 : 1,
                                        backgroundColor: `${colors.accent}06`,
                                    })}
                                    onPress={() => {
                                        const input = document.createElement("input");
                                        input.type = "file";
                                        input.accept = ".dylib";
                                        input.multiple = true;
                                        input.onchange = (e: any) => {
                                            const files: File[] = Array.from(e.target.files || []);
                                            if (files.length === 0) return;
                                            onChange({ ...options, dylibFiles: [...options.dylibFiles, ...files] });
                                            setDylibs(prev => [...prev, ...files.map(f => f.name)]);
                                        };
                                        input.click();
                                    }}
                                >
                                    <Ionicons name="cloud-upload-outline" size={26} color={colors.accent} />
                                    <Text style={{
                                        color: colors.accent,
                                        fontSize: 14,
                                        fontWeight: "600",
                                    }}>
                                        Seleccionar .dylib
                                    </Text>
                                    <Text style={{
                                        color: colors.textSecondary,
                                        fontSize: 11,
                                        textAlign: "center",
                                    }}>
                                        Se inyectan en Payload/App.app/Frameworks/
                                    </Text>
                                </Pressable>

                                {options.dylibFiles.length > 0 && (
                                    <View style={{ marginTop: 10, gap: 6 }}>
                                        {options.dylibFiles.map((f, i) => (
                                            <View key={i} style={{
                                                flexDirection: "row",
                                                alignItems: "center",
                                                backgroundColor: `${colors.accent}10`,
                                                borderRadius: 10,
                                                paddingHorizontal: 12,
                                                paddingVertical: 10,
                                                borderWidth: 1,
                                                borderColor: `${colors.accent}28`,
                                            }}>
                                                <Ionicons name="cube-outline" size={14} color={colors.accent} />
                                                <Text style={{
                                                    flex: 1,
                                                    color: colors.text,
                                                    fontSize: 13,
                                                    marginLeft: 8,
                                                }} numberOfLines={1}>
                                                    {f.name}
                                                </Text>
                                                <Pressable
                                                    hitSlop={8}
                                                    onPress={() => {
                                                        const newFiles = options.dylibFiles.filter((_, idx) => idx !== i);
                                                        onChange({ ...options, dylibFiles: newFiles });
                                                    }}
                                                >
                                                    <Ionicons name="close-circle" size={18} color={colors.danger} />
                                                </Pressable>
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </View>
                        ) : (
                            <View style={{
                                borderRadius: 12,
                                padding: 14,
                                backgroundColor: `${colors.accent}08`,
                                borderWidth: 1,
                                borderColor: `${colors.accent}25`,
                                alignItems: "center",
                            }}>
                                <Text style={{
                                    color: colors.textSecondary,
                                    fontSize: 12,
                                    textAlign: "center",
                                }}>
                                    La inyección de dylibs está disponible en la versión web
                                </Text>
                            </View>
                        )}

                        {/* Espaciado final */}
                        <View style={{ height: 4 }} />
                    </Animated.View>
                )}
            </View>
        </Animated.View>
    );
}
