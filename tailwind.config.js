/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4: escanea los archivos de la app para detectar clases
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Paleta oscura principal de SpeedySign (rojo + negro)
        background: "#080808",
        card: "#121212",
        accent: "#E53935",
        "accent-light": "#EF5350",
        "text-primary": "#FFFFFF",
        "text-secondary": "#808080",
        danger: "#FF4D4D",
        success: "#4CAF50",
        warning: "#FFC107",
        // Paleta clara alternativa
        "light-bg": "#F5F5F5",
        "light-card": "#FFFFFF",
        "light-text": "#1A1A1A",
        "light-secondary": "#666666",
      },
    },
  },
  plugins: [],
};
