/**
 * defaultRepos.ts
 * Repositorios predeterminados que vienen preconfigurados con la app.
 * Cada repositorio contiene información básica y una URL que apunta
 * a un JSON con el catálogo de aplicaciones disponibles.
 */

/** Interfaz que define la estructura de un repositorio */
export interface Repo {
    id: string;           // Identificador único del repositorio
    name: string;         // Nombre visible del repositorio
    url: string;          // URL del JSON con las apps
    icon: string;         // URL del icono del repositorio
    description: string;  // Descripción breve del repositorio
    enabled: boolean;     // Si el repositorio está activo o no
    isDefault: boolean;   // Si es un repositorio predeterminado (no eliminable)
    category: "jailbreak" | "sideload"; // Categoría del repositorio
}

/** Interfaz para una app dentro del catálogo de un repositorio */
export interface AppItem {
    name: string;         // Nombre de la aplicación
    bundleID: string;     // Bundle ID (ej: com.example.app)
    version: string;      // Versión de la app
    icon: string;         // URL del icono de la app
    description: string;  // Descripción de la app
    downloadURL: string;  // URL de descarga del archivo IPA
    size?: string;        // Tamaño del archivo (opcional)
    repoName?: string;    // Nombre del repositorio de origen
    category?: "jailbreak" | "sideload"; // Categoría de la app (heredada del repo)
}

/** Interfaz del JSON completo de un repositorio */
export interface RepoData {
    name: string;         // Nombre del repositorio
    apps: AppItem[];      // Lista de aplicaciones
    icon?: string;        // Icono opcional del repositorio
    description?: string; // Descripción opcional del repositorio
}

/**
 * Lista de repositorios predeterminados de código abierto y utilidades legales.
 * Se eliminaron todos los repositorios externos con potencial piratería para proteger legalmente el hosting.
 */
export const defaultRepos: Repo[] = [
    {
        id: "repo-ish",
        name: "iSH Shell",
        url: "https://ish.app/altstore.json",
        icon: "https://img.icons8.com/color/96/console.png",
        description: "iSH — Terminal Linux local para iOS.",
        enabled: true,
        isDefault: true,
        category: "sideload",
    },
    {
        id: "repo-itorrent",
        name: "iTorrent",
        url: "https://xitrix.github.io/iTorrent/AltStore.json",
        icon: "https://img.icons8.com/color/96/utorrent.png",
        description: "iTorrent — Cliente de Torrents de código abierto para iOS.",
        enabled: true,
        isDefault: true,
        category: "sideload",
    },
    {
        id: "repo-winston",
        name: "Winston (Reddit)",
        url: "https://raw.githubusercontent.com/lo-cafe/winston-altstore/main/apps.json",
        icon: "https://img.icons8.com/color/96/reddit.png",
        description: "Winston — Cliente de Reddit de código abierto.",
        enabled: true,
        isDefault: true,
        category: "sideload",
    },
    {
        id: "repo-sidestore-connect",
        name: "SideStore Connect",
        url: "https://connect.sidestore.io/apps.json",
        icon: "https://img.icons8.com/color/96/connected--v1.png",
        description: "Utilidades oficiales para la suite de SideStore.",
        enabled: true,
        isDefault: true,
        category: "sideload",
    },
    {
        id: "repo-sidestore-community",
        name: "SideStore Community",
        url: "https://community-apps.sidestore.io/sidecommunity.json",
        icon: "https://img.icons8.com/color/96/conference-call--v1.png",
        description: "Aplicaciones libres aportadas por la comunidad de SideStore.",
        enabled: true,
        isDefault: true,
        category: "sideload",
    },
    {
        id: "repo-utm",
        name: "UTM Virtual Machines",
        url: "https://alt.getutm.app",
        icon: "https://img.icons8.com/color/96/virtual-machine.png",
        description: "Emulación de máquinas virtuales y sistemas operativos completos en iOS.",
        enabled: true,
        isDefault: true,
        category: "sideload",
    }
];
