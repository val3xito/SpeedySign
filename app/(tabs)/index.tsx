import { Redirect } from "expo-router";

/**
 * index.tsx - Redirige a Explorar como pantalla de inicio.
 * Los Repositorios son accesibles desde Ajustes → Repositorios (/repositories).
 */
export default function ReposRedirect() {
    return <Redirect href="/(tabs)/explore" />;
}
