/**
 * Configuración de i18next para internacionalización
 * Requiere: npm install i18next react-i18next expo-localization
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import es from './locales/es.json';

const resources = {
  en: { translation: en },
  es: { translation: es },
};

const getDeviceLocale = (): string => {
  try {
    // Verificar idioma del navegador si está disponible (soporte web)
    if (typeof navigator !== 'undefined') {
      if (navigator.languages && navigator.languages.length > 0) {
        const mainLang = navigator.languages[0].toLowerCase();
        if (mainLang.startsWith('es')) return 'es';
      }
      if (navigator.language) {
        const mainLang = navigator.language.toLowerCase();
        if (mainLang.startsWith('es')) return 'es';
      }
    }

    // Verificar idioma del dispositivo nativo usando expo-localization
    const locales = Localization.getLocales();
    if (locales && locales.length > 0 && locales[0].languageCode) {
      const code = locales[0].languageCode.toLowerCase();
      if (code.startsWith('es')) {
        return 'es';
      }
    }
  } catch (error) {
    console.warn('Error obteniendo locale:', error);
  }
  return 'en';
};

const initI18n = async () => {
    try {
        const storedLanguage = await AsyncStorage.getItem('app_language');
        const languageToUse = storedLanguage || getDeviceLocale();

        await i18n
            .use(initReactI18next)
            .init({
                resources,
                lng: languageToUse,
                fallbackLng: 'en',
                interpolation: {
                    escapeValue: false,
                },
            });
    } catch (e) {
        console.warn('Error initializing i18n', e);
        // Fallback robusto en caso de fallo crítico
        await i18n.use(initReactI18next).init({
            resources,
            lng: 'en',
            fallbackLng: 'en',
        });
    }
};

initI18n();

export default i18n;
