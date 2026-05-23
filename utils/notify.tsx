import React from 'react';
import { sileo, Toaster } from 'sileo';
import { Platform, Alert, View, Text, Pressable } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { Ionicons } from '@expo/vector-icons';

export function SileoToaster() {
  const { isDark } = useTheme();

  if (Platform.OS !== 'web') return null;
  // Use pure DOM div styling to ensure fixed positioning works on RN Web
  return React.createElement(
    'div',
    {
      style: { position: 'fixed', zIndex: 99999, pointerEvents: 'none', top: 0, left: 0, right: 0, bottom: 0 }
    },
    <Toaster position="top-center" theme={isDark ? 'light' : 'dark'} />
  );
}

export const notify = {
  success: (title: string, message?: string, duration: number = 3000) => {
    if (Platform.OS === 'web') {
      const id = `sileo-success-${Date.now()}`;
      sileo.success({ title, description: message, duration, id } as any);
      // Force-dismiss after duration so the pill doesn't linger
      setTimeout(() => sileo.dismiss(id), duration);
    } else {
      Alert.alert(title, message);
    }
  },
  error: (title: string, message?: string) => {
    if (Platform.OS === 'web') {
      sileo.error({ title, description: message });
    } else {
      Alert.alert(title, message);
    }
  },
  info: (title: string, message?: string): string | null => {
    if (Platform.OS === 'web') {
      const id = `sileo-info-${Date.now()}`;
      sileo.info({ title, description: message, id } as any);
      return id;
    } else {
      Alert.alert(title, message);
      return null;
    }
  },
  dismiss: (id: string | null) => {
    if (Platform.OS === 'web' && id) {
      sileo.dismiss(id);
    }
  },
  confirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void, iconName?: any) => {
    if (Platform.OS === 'web') {
      let id = '';
      id = sileo.show({
        type: 'error',
        title: title,
        icon: iconName ? (
            <Text style={{ color: '#FF3B30' }}>
               <Ionicons name={iconName} size={20} color="#FF3B30" />
            </Text>
        ) : undefined,
        duration: 3500, // 3.5 segundos como solicitó el usuario
        description: (
          <View style={{ marginTop: 4 }}>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, marginBottom: 12 }}>{message}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {/* Botón Cancelar (Fondo rojo tenue como el botón Eliminar Repositorio) */}
              <Pressable
                onPress={() => {
                  if (onCancel) onCancel();
                  sileo.dismiss(id);
                }}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: pressed ? 'rgba(255, 59, 48, 0.3)' : 'rgba(255, 59, 48, 0.15)', // Fondo rojo translúcido
                })}
              >
                <Ionicons name="close" size={20} color="#FF3B30" />
              </Pressable>

              {/* Botón Confirmar */}
              <Pressable
                onPress={() => {
                  onConfirm();
                  sileo.dismiss(id);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#FFF',
                  justifyContent: 'center',
                  alignItems: 'center',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '700' }}>Confirmar</Text>
              </Pressable>
            </View>
          </View>
        )
      });
    } else {
      Alert.alert(title, message, [
        { text: "Cancelar", style: "cancel", onPress: onCancel },
        { text: "Aceptar", style: "destructive", onPress: onConfirm }
      ]);
    }
  }
};
