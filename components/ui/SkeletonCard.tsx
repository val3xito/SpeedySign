/**
 * Componente skeleton para estados de carga
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

export function SkeletonCard() {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <View style={styles.image} />
      <View style={styles.content}>
        <View style={styles.title} />
        <View style={styles.subtitle} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    marginBottom: 12,
  },
  image: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: '#e0e0e0',
  },
  content: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  title: {
    height: 20,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    marginBottom: 8,
    width: '70%',
  },
  subtitle: {
    height: 16,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    width: '50%',
  },
});
