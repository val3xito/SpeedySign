/**
 * useRepos.ts
 * Hook personalizado para gestionar repositorios.
 * Carga repos desde AsyncStorage, los combina con los predeterminados,
 * y proporciona funciones para añadir, eliminar, activar/desactivar
 * y restaurar los repos por defecto.
 */

import { useRepositoryContext } from "../contexts/RepositoryContext";

/**
 * Hook que gestiona el estado de los repositorios.
 * @returns Objeto con repos, loading, y funciones de gestión
 */
export function useRepos() {
    return useRepositoryContext();
}
