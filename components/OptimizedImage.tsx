/**
 * Componente de imagen optimizado con fallback y soporte de proxy CORS.
 */

import React, { useState } from 'react';
import { Image, ImageProps, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getImgProxyUrl } from '../utils/imgProxy';

interface OptimizedImageProps extends Omit<ImageProps, 'source'> {
  uri: string;
  /** Si true (por defecto), enruta la imagen por el proxy CORS del servidor */
  useProxy?: boolean;
  fallbackIcon?: keyof typeof Ionicons.glyphMap;
}

export function OptimizedImage({
  uri,
  useProxy = true,
  fallbackIcon = 'apps-outline',
  style,
  ...props
}: OptimizedImageProps) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  if (error || !uri) {
    return (
      <View style={[styles.fallback, style]}>
        <Ionicons name={fallbackIcon} size={40} color="#666" />
      </View>
    );
  }

  const resolvedUri = useProxy ? getImgProxyUrl(uri) : uri;

  return (
    <Image
      source={{ uri: resolvedUri }}
      style={style}
      onError={() => setError(true)}
      onLoadEnd={() => setLoading(false)}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
