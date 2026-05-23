/**
 * certificates.tsx - Pantalla de Certificados
 * Permite importar archivos .p12 y .mobileprovision desde el dispositivo.
 * Muestra la lista de certificados con su estado de validez.
 * Incluye opciones para eliminar certificados.
 * Usa modales en lugar de Alert para compatibilidad web.
 */

import React, { useState } from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Modal,
    Platform,
    TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Stack, useRouter } from "expo-router";
import { useTheme } from "../hooks/useTheme";
import { useCertificates, DEFAULT_CERTIFICATES, MAX_CERTIFICATES } from "../hooks/useCertificates";
import { CertificateBadge } from "../components/CertificateBadge";
import { useHeaderHeight } from '@react-navigation/elements';
import { validateP12Password } from '../utils/validateP12';
import { notify } from "../utils/notify";

/**
 * Pantalla de gestión de certificados.
 * Permite importar, ver y eliminar certificados de firma.
 */
export default function CertificatesScreen() {
    const { colors, isDark } = useTheme();
    const router = useRouter();
    const {
        certificates,
        loading,
        hasValidCertificate,
        importCertificate,
        removeCertificate,
        activeCertificateId,
        setActiveCertificate,
        deactivateCertificate,
        verifyCertificate,
    } = useCertificates();
    const headerHeight = useHeaderHeight();

    // Límite de slots de certificado
    const atLimit = certificates.length >= MAX_CERTIFICATES;

    const [importing, setImporting] = useState(false);

    // Estado del modal de importación por pasos
    const [importModal, setImportModal] = useState(false);
    const [importStep, setImportStep] = useState<"p12" | "provision" | "confirm" | "done">("p12");
    const [p12Name, setP12Name] = useState("");
    const [p12URI, setP12URI] = useState("");
    const [p12File, setP12File] = useState<File | undefined>(undefined);
    const [p12Password, setP12Password] = useState("");
    const [provName, setProvName] = useState("");
    const [provURI, setProvURI] = useState("");
    const [provFile, setProvFile] = useState<File | undefined>(undefined);
    const [validationError, setValidationError] = useState("");
    const [validating, setValidating] = useState(false);



    /**
     * Abre el modal de importación de certificado.
     */
    const handleOpenImportModal = () => {
        setP12Name("");
        setP12URI("");
        setP12File(undefined);
        setP12Password("");
        setProvName("");
        setProvURI("");
        setProvFile(undefined);
        setImportStep("p12");
        setImportModal(true);
    };

    /**
     * Paso 1: Seleccionar archivo .p12
     */
    const handlePickP12 = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: "*/*",
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) {
                return;
            }

            const file = result.assets[0];
            const fileName = file.name?.toLowerCase() || "";
            if (!fileName.endsWith(".p12")) {
                notify.error("Error", "Debes seleccionar un archivo .p12 válido.");
                return;
            }

            setP12Name(file.name || "certificado.p12");
            setP12URI(file.uri);
            setP12File((file as any).file);
            // No cambiamos de paso aún, mostramos el campo de contraseña
        } catch (error) {
            console.error("Error al seleccionar .p12:", error);
        }
    };

    /**
     * Paso 2: Seleccionar archivo .mobileprovision y finalizar importación.
     */
    const handlePickProvision = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: "*/*",
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) {
                return;
            }

            const file = result.assets[0];
            const fileName = file.name?.toLowerCase() || "";
            if (!fileName.endsWith(".mobileprovision")) {
                notify.error("Error", "Debes seleccionar un archivo .mobileprovision válido.");
                return;
            }
            setProvName(file.name || "perfil.mobileprovision");
            setProvURI(file.uri);
            setProvFile((file as any).file);
            setImportStep("confirm");
        } catch (error) {
            console.error("Error al seleccionar .mobileprovision:", error);
        }
    };

    /**
     * Paso 3: Confirmar e importar el certificado a Supabase.
     */
    const handleConfirmImport = async () => {
        try {
            setValidationError("");
            setValidating(true);

            // Validar contraseña del .p12 antes de subir a Supabase
            console.log("[SpeedySign] Validando contraseña del .p12...");
            const validation = await validateP12Password(p12URI, p12Password, p12File);

            if (!validation.valid) {
                setValidationError(validation.error || "Contraseña incorrecta");
                setValidating(false);
                // Volver al paso de contraseña sin perder los archivos
                setP12Password("");
                setImportStep("p12");
                return;
            }

            console.log("[SpeedySign] Contraseña válida ✅", validation.commonName);
            setValidating(false);
            setImporting(true);

            await importCertificate(
                p12Name, 
                p12Password, 
                provName, 
                p12URI, 
                provURI, 
                validation.commonName, 
                validation.expirationDate,
                p12File,
                provFile
            );
            
            // Si hay pem, opcionalmente verificar OCSP, pero por ahora solo importamos.
            setImportStep("done");
            setTimeout(() => {
                setImportModal(false);
                setImporting(false);
            }, 1500);
        } catch (error: any) {
            console.error("Error al importar:", error);
            notify.error("Error", `No se pudo importar: ${error.message || "Error desconocido"}. Inténtalo de nuevo.`);
            setImporting(false);
            setValidating(false);
        }
    };



    if (loading) {
        return (
            <View
                style={{
                    flex: 1,
                    backgroundColor: colors.background,
                    justifyContent: "center",
                    alignItems: "center",
                }}
            >
                <ActivityIndicator size="large" color={colors.accent} />
            </View>
        );
    }

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: colors.background }}
            contentContainerStyle={{ padding: 16, paddingTop: headerHeight + 10, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
        >
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTransparent: true,
                    headerBackground: () => (
                        <LinearGradient
                            colors={[
                                isDark ? "rgba(18,18,18,1)" : "rgba(245,245,247,1)",
                                isDark ? "rgba(18,18,18,0.9)" : "rgba(245,245,247,0.9)",
                                isDark ? "rgba(18,18,18,0.4)" : "rgba(245,245,247,0.4)",
                                "transparent"
                            ]}
                            locations={[0, 0.5, 0.8, 1]}
                            style={{ width: "100%", height: "150%" }}
                            pointerEvents="none"
                        />
                    ),
                    headerTitle: "Certificados",
                    headerTitleAlign: "center",
                    headerStyle: { backgroundColor: "transparent" },
                    headerTintColor: colors.accent,
                    headerTitleStyle: {
                        color: colors.text,
                        fontWeight: "700",
                        fontSize: 18,
                    },
                    headerLeft: () => (
                        <Pressable
                            onPress={() => router.back()}
                            style={({ pressed }) => ({
                                opacity: pressed ? 0.7 : 1,
                                marginLeft: 8,
                                width: 38,
                                height: 38,
                                borderRadius: 19,
                                justifyContent: "center",
                                alignItems: "center",
                                backgroundColor: isDark
                                    ? "rgba(255,255,255,0.10)"
                                    : "rgba(255,255,255,0.65)",
                                borderWidth: 1,
                                borderColor: isDark
                                    ? "rgba(255,255,255,0.15)"
                                    : "rgba(255,255,255,0.8)",
                                shadowColor: "#000",
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.2,
                                shadowRadius: 4,
                                elevation: 4,
                            })}
                        >
                            <Ionicons name="arrow-back" size={20} color={colors.accent} />
                        </Pressable>
                    ),
                }}
            />
            {/* Banner de aviso si no hay certificado válido */}
            {!hasValidCertificate && (
                <Animated.View
                    entering={FadeInDown.duration(400)}
                    style={{
                        backgroundColor: `${colors.warning}18`,
                        borderRadius: 16,
                        padding: 14,
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 16,
                        borderWidth: 1,
                        borderColor: `${colors.warning}35`,
                    }}
                >
                    <Ionicons name="warning" size={22} color={colors.warning} />
                    <Text
                        style={{
                            color: colors.warning,
                            fontSize: 13,
                            fontWeight: "500",
                            marginLeft: 10,
                            flex: 1,
                        }}
                    >
                        No tienes un certificado válido. Importa uno para poder firmar apps.
                    </Text>
                </Animated.View>
            )}

            {/* Banner de límite alcanzado */}
            {atLimit && (
                <Animated.View
                    entering={FadeInDown.duration(400)}
                    style={{
                        backgroundColor: "#FF4D4D15",
                        borderRadius: 16,
                        padding: 14,
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 16,
                        borderWidth: 1,
                        borderColor: "#FF4D4D35",
                    }}
                >
                    <Ionicons name="lock-closed" size={20} color="#FF4D4D" />
                    <Text
                        style={{
                            color: "#FF4D4D",
                            fontSize: 13,
                            fontWeight: "500",
                            marginLeft: 10,
                            flex: 1,
                        }}
                    >
                        Has alcanzado el límite de {MAX_CERTIFICATES} certificados. Elimina uno para poder importar otro.
                    </Text>
                </Animated.View>
            )}

            {/* Botón de importar certificado */}
            <Pressable
                onPress={atLimit ? undefined : handleOpenImportModal}
                style={({ pressed }) => ({
                    backgroundColor: atLimit ? colors.textSecondary : colors.accent,
                    borderRadius: 14,
                    padding: 16,
                    flexDirection: "row",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 8,
                    opacity: atLimit ? 0.45 : pressed ? 0.8 : 1,
                    marginBottom: 8,
                })}
            >
                <Ionicons
                    name={atLimit ? "lock-closed-outline" : "add-circle-outline"}
                    size={22}
                    color="#FFFFFF"
                />
                <Text
                    style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "600" }}
                >
                    {atLimit ? "Límite alcanzado" : "Importar Certificado"}
                </Text>
            </Pressable>

            {/* Modal de importación paso a paso */}
            <Modal
                visible={importModal}
                transparent
                animationType="fade"
                onRequestClose={() => { if (!importing) setImportModal(false); }}
            >
                <Pressable
                    onPress={() => { if (!importing) setImportModal(false); }}
                    style={{
                        flex: 1,
                        backgroundColor: "rgba(0,0,0,0.6)",
                        justifyContent: "center",
                        alignItems: "center",
                        padding: 24,
                    }}
                >
                    <Pressable
                        onPress={() => { }}
                        style={{
                            backgroundColor: colors.card,
                            borderRadius: 16,
                            padding: 24,
                            width: "100%",
                            maxWidth: 360,
                            borderWidth: 1,
                            borderColor: colors.cardBorder,
                        }}
                    >
                        <Text
                            style={{
                                color: colors.text,
                                fontSize: 18,
                                fontWeight: "700",
                                marginBottom: 16,
                            }}
                        >
                            Importar Certificado
                        </Text>

                        {/* Paso 1: Seleccionar .p12 */}
                        <Pressable
                            onPress={handlePickP12}
                            disabled={importStep !== "p12"}
                            style={({ pressed }) => ({
                                backgroundColor: p12Name
                                    ? `${colors.accent}18`
                                    : importStep === "p12"
                                        ? `${colors.accent}12`
                                        : colors.background,
                                borderRadius: 12,
                                padding: 14,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 10,
                                marginBottom: 12,
                                borderWidth: 1,
                                borderColor: p12Name ? `${colors.accent}50` : `${colors.accent}35`,
                                opacity: pressed && importStep === "p12" ? 0.7 : 1,
                            })}
                        >
                            <Ionicons
                                name={p12Name ? "checkmark-circle" : "document-outline"}
                                size={22}
                                color={colors.accent}
                            />
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
                                    {p12Name ? p12Name : "1. Seleccionar archivo .p12"}
                                </Text>
                                {!p12Name && importStep === "p12" && (
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                                        Pulsa para seleccionar
                                    </Text>
                                )}
                            </View>
                        </Pressable>

                        {/* Contraseña .p12 (Aparece al seleccionar el p12) */}
                        {p12Name !== "" && importStep === "p12" && (
                            <Animated.View entering={FadeInDown.duration(300)}>
                                {/* Error de contraseña inline */}
                                {validationError ? (
                                    <Animated.View
                                        entering={FadeInDown.duration(200)}
                                        style={{
                                            backgroundColor: "#FF4D4D15",
                                            borderRadius: 10,
                                            padding: 10,
                                            marginBottom: 10,
                                            borderWidth: 1,
                                            borderColor: "#FF4D4D35",
                                            flexDirection: "row",
                                            alignItems: "center",
                                            gap: 8,
                                        }}
                                    >
                                        <Ionicons name="alert-circle" size={18} color="#FF4D4D" />
                                        <Text style={{ color: "#FF4D4D", fontSize: 13, flex: 1 }}>
                                            {validationError}
                                        </Text>
                                    </Animated.View>
                                ) : null}
                                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, marginLeft: 4 }}>
                                    Contraseña del certificado{validationError ? " — inténtalo de nuevo:" : " (opcional):"}  
                                </Text>
                                <TextInput
                                    placeholder="Contraseña del .p12"
                                    placeholderTextColor={colors.textSecondary + "80"}
                                    value={p12Password}
                                    onChangeText={(v) => {
                                        setP12Password(v);
                                        if (validationError) setValidationError(""); // limpiar error al escribir
                                    }}
                                    secureTextEntry
                                    autoFocus={!!validationError}
                                    style={{
                                        backgroundColor: colors.background,
                                        borderRadius: 12,
                                        padding: 14,
                                        color: colors.text,
                                        marginBottom: 12,
                                        borderWidth: 1,
                                        borderColor: validationError ? "#FF4D4D" : colors.cardBorder,
                                    }}
                                />
                                <Pressable
                                    onPress={() => {
                                        // Si el .mobileprovision ya está seleccionado, saltar directo a confirm
                                        setImportStep(provName ? "confirm" : "provision");
                                    }}
                                    style={({ pressed }) => ({
                                        backgroundColor: colors.accent,
                                        borderRadius: 12,
                                        padding: 14,
                                        alignItems: "center",
                                        marginBottom: 16,
                                        opacity: pressed ? 0.8 : 1,
                                    })}
                                >
                                    <Text style={{ color: "#FFF", fontWeight: "600" }}>Continuar</Text>
                                </Pressable>
                            </Animated.View>
                        )}

                        {/* Paso 2: Seleccionar .mobileprovision */}
                        <Pressable
                            onPress={handlePickProvision}
                            disabled={importStep !== "provision" || importing}
                            style={({ pressed }) => ({
                                backgroundColor: provName
                                    ? `${colors.accent}18`
                                    : importStep === "provision"
                                        ? `${colors.accent}12`
                                        : colors.background,
                                borderRadius: 12,
                                padding: 14,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 10,
                                marginBottom: 16,
                                borderWidth: 1,
                                borderColor: provName ? `${colors.accent}50` : importStep === "provision" ? `${colors.accent}35` : colors.cardBorder,
                                opacity: (pressed && importStep === "provision") ? 0.7 : importStep === "p12" ? 0.4 : 1,
                            })}
                        >
                            <Ionicons
                                name={provName ? "checkmark-circle" : "document-outline"}
                                size={22}
                                color={importStep === "p12" ? colors.textSecondary : colors.accent}
                            />
                            <View style={{ flex: 1 }}>
                                <Text style={{
                                    color: importStep === "p12" ? colors.textSecondary : colors.text,
                                    fontSize: 14,
                                    fontWeight: "600",
                                }}>
                                    {provName ? provName : "2. Seleccionar .mobileprovision"}
                                </Text>
                                {!provName && importStep === "provision" && (
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                                        Pulsa para seleccionar
                                    </Text>
                                )}
                            </View>
                        </Pressable>

                        {/* Paso 3: Botón de confirmación */}
                        {importStep === "confirm" && !importing && (
                            <Animated.View entering={FadeInDown.duration(300)}>
                                <View style={{
                                    backgroundColor: `${colors.accent}10`,
                                    borderRadius: 12,
                                    padding: 14,
                                    marginBottom: 12,
                                    borderWidth: 1,
                                    borderColor: `${colors.accent}28`,
                                }}>
                                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }}>
                                        Resumen:
                                    </Text>
                                    <Text style={{ color: colors.text, fontSize: 13 }}>
                                        • {p12Name}
                                    </Text>
                                    <Text style={{ color: colors.text, fontSize: 13 }}>
                                        • {provName}
                                    </Text>
                                </View>

                                {validationError ? (
                                    <View style={{
                                        backgroundColor: `${colors.danger}15`,
                                        padding: 12,
                                        borderRadius: 8,
                                        marginBottom: 12,
                                        borderWidth: 1,
                                        borderColor: `${colors.danger}30`,
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 8,
                                    }}>
                                        <Ionicons name="alert-circle" size={20} color={colors.danger} />
                                        <Text style={{ color: colors.danger, fontSize: 13, flex: 1 }}>
                                            {validationError}
                                        </Text>
                                    </View>
                                ) : null}

                                <Pressable
                                    onPress={handleConfirmImport}
                                    disabled={validating}
                                    style={({ pressed }) => ({
                                        backgroundColor: validating ? colors.textSecondary : colors.accent,
                                        borderRadius: 12,
                                        padding: 16,
                                        alignItems: "center",
                                        marginBottom: 12,
                                        opacity: pressed || validating ? 0.8 : 1,
                                        flexDirection: "row",
                                        justifyContent: "center",
                                        gap: 8,
                                    })}
                                >
                                    {validating ? (
                                        <ActivityIndicator size="small" color="#FFF" />
                                    ) : (
                                        <Ionicons name="cloud-upload-outline" size={20} color="#FFF" />
                                    )}
                                    <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 16 }}>
                                        {validating ? "Validando certificado..." : "Importar Certificado"}
                                    </Text>
                                </Pressable>
                            </Animated.View>
                        )}

                        {/* Estado: Importando / Éxito */}
                        {importing && importStep !== "done" && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                                <ActivityIndicator size="small" color={colors.accent} />
                                <Text style={{ color: colors.accent, fontSize: 13 }}>Subiendo a la nube...</Text>
                            </View>
                        )}
                        {importStep === "done" && (
                            <View style={{
                                flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12,
                                backgroundColor: `${colors.accent}18`, borderRadius: 10, padding: 12,
                                borderWidth: 1, borderColor: `${colors.accent}35`,
                            }}>
                                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                                <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>
                                    ¡Certificado importado!
                                </Text>
                            </View>
                        )}

                        {/* Botón cancelar */}
                        {!importing && importStep !== "done" && (
                            <Pressable
                                onPress={() => setImportModal(false)}
                                style={({ pressed }) => ({
                                    backgroundColor: colors.background,
                                    borderRadius: 12,
                                    padding: 14,
                                    alignItems: "center",
                                    opacity: pressed ? 0.8 : 1,
                                    borderWidth: 1,
                                    borderColor: colors.cardBorder,
                                })}
                            >
                                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancelar</Text>
                            </Pressable>
                        )}
                    </Pressable>
                </Pressable>
            </Modal>


            {/* SECCIÓN 2: CERTIFICADOS IMPORTADOS */}
            {/* Contador de slots */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, marginTop: 12 }}>
                <Text
                    style={{
                        color: colors.textSecondary,
                        fontSize: 13,
                        fontWeight: "600",
                        textTransform: "uppercase",
                        letterSpacing: 1,
                    }}
                >
                    Certificados importados
                </Text>
                {/* Indicador de slots: ● ● ○ */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {Array.from({ length: MAX_CERTIFICATES }).map((_, i) => (
                        <View
                            key={i}
                            style={{
                                width: 10,
                                height: 10,
                                borderRadius: 5,
                                backgroundColor: i < certificates.length
                                    ? (atLimit ? "#FF4D4D" : colors.accent)
                                    : `${colors.textSecondary}40`,
                                borderWidth: 1,
                                borderColor: i < certificates.length
                                    ? (atLimit ? "#FF4D4D60" : `${colors.accent}60`)
                                    : `${colors.textSecondary}20`,
                            }}
                        />
                    ))}
                    <Text style={{ color: atLimit ? "#FF4D4D" : colors.textSecondary, fontSize: 12, fontWeight: "700", marginLeft: 2 }}>
                        {certificates.length} / {MAX_CERTIFICATES}
                    </Text>
                </View>
            </View>

            {/* Lista de certificados */}
            {certificates.length === 0 ? (
                <View
                    style={{
                        alignItems: "center",
                        paddingVertical: 40,
                    }}
                >
                    <Ionicons
                        name="shield-outline"
                        size={64}
                        color={colors.textSecondary}
                    />
                    <Text
                        style={{
                            color: colors.textSecondary,
                            fontSize: 15,
                            marginTop: 12,
                            textAlign: "center",
                        }}
                    >
                        No hay certificados importados.{"\n"}
                        Pulsa el botón de arriba para importar uno.
                    </Text>
                </View>
            ) : (
                certificates.map((cert, index) => (
                    <CertificateBadge
                        key={cert.id}
                        certificate={cert}
                        index={index}
                        isActive={activeCertificateId === cert.id}
                        onToggleActive={(active) => {
                            if (active) setActiveCertificate(cert.id);
                            else deactivateCertificate(cert.id);
                        }}
                        onVerify={async () => {
                            const verifyingId = notify.info("Verificando", "Consultando estado con Apple...");
                            const res = await verifyCertificate(cert);
                            notify.dismiss(verifyingId);
                            if (res.success) {
                                notify.success("Verificación Exitosa", res.message);
                            } else {
                                notify.error("Aviso o Error", res.message);
                            }
                        }}
                        onDelete={() => {
                            notify.confirm(
                                "Eliminar certificado",
                                `¿Estás seguro de que quieres eliminar "${cert.name}"? Esta acción no se puede deshacer.`,
                                async () => {
                                    await removeCertificate(cert.id);
                                }
                            );
                        }}
                    />
                ))
            )}


        </ScrollView>
    );
}
