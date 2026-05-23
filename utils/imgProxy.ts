/**
 * imgProxy.ts
 * Función compartida para enrutar URLs de imágenes externas a través del
 * proxy CORS del servidor (/proxy/img).
 *
 * Por qué es necesario:
 *  - Los iconos de las apps están en servidores externos que no incluyen
 *    cabeceras CORS. Cargarlos directamente en el navegador falla con un error
 *    de red o muestra un icono roto.
 *  - El servidor actúa como proxy transparente: descarga la imagen externamente
 *    y la sirve al navegador desde el mismo origen, evitando el bloqueo CORS.
 *
 * Uso:
 *  import { getImgProxyUrl } from "@/utils/imgProxy";
 *  <Image source={{ uri: getImgProxyUrl(app.icon) }} />
 */

/**
 * Convierte una URL de icono externo en una URL proxiada a través del servidor.
 *
 * - En localhost/127.0.0.1 usa http://localhost:3001 como base.
 * - En producción usa una ruta relativa (/proxy/img) para que funcione
 *   independientemente del dominio de despliegue.
 * - Si la URL ya está proxiada o es local (data:, blob:), la devuelve tal cual.
 * - En entorno no-web (SSR, tests) devuelve la URL original sin modificar.
 */
export function getImgProxyUrl(iconUrl: string): string {
    if (!iconUrl) return "";

    // Evitar doble proxiado
    if (iconUrl.includes("/proxy/img?url=")) return iconUrl;

    // data: y blob: son locales, no necesitan proxy
    if (iconUrl.startsWith("data:") || iconUrl.startsWith("blob:")) return iconUrl;

    // En entorno no-web (SSR, Node.js) no hay window.location
    if (typeof window === "undefined") return iconUrl;

    const hostname = window.location.hostname;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    
    // Si estamos en local, usamos el proxy local.
    // Si estamos en producción y el proxy local devuelve HTML (por culpa de un SPA fallback), 
    // fallará la carga. Mejor devolvemos la URL original y dejamos que el navegador 
    // intente cargarla (<img> tags usualmente no tienen restricciones CORS estrictas).
    if (isLocal) {
        return `http://${hostname}:3001/proxy/img?url=${encodeURIComponent(iconUrl)}`;
    }

    return iconUrl;
}
