/**
 * Utilidades para sanitizar entradas de usuario.
 * Previene XSS, inyección y path traversal.
 */

/**
 * Sanitiza un nombre de archivo.
 * Elimina caracteres peligrosos que podrían permitir path traversal o inyección.
 * @previene Path traversal (../../etc/passwd), inyección de comandos
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 255); // Límite de longitud
}

/**
 * Sanitiza una URL eliminando fragmentos y validando el formato.
 * @previene Open redirect, SSRF con protocolos arbitrarios
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remover fragmentos
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Escapa caracteres HTML peligrosos para prevenir XSS.
 * Usar al renderizar datos de fuentes externas (repos, API).
 * @previene Cross-Site Scripting (XSS)
 */
export function escapeHTML(str: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
  };
  return str.replace(/[&<>"']/g, (char) => escapeMap[char] || char);
}

/**
 * Valida que una URL use un protocolo seguro.
 * Solo permite https:, blob: y file: (para archivos locales).
 * @previene SSRF, descarga desde fuentes no seguras, data: URI attacks
 */
export function validateProtocol(url: string): boolean {
  if (!url) return false;
  const allowedProtocols = ['https:', 'blob:', 'file:'];
  try {
    const parsed = new URL(url);
    return allowedProtocols.includes(parsed.protocol);
  } catch {
    // URLs relativas son válidas (misma app)
    return url.startsWith('/');
  }
}

/**
 * Sanitiza un string para uso seguro: elimina tags HTML y trim.
 * @previene XSS al mostrar datos de repos en la UI
 */
export function sanitizeText(text: string, maxLength = 500): string {
  return text
    .replace(/<[^>]*>/g, '') // Eliminar tags HTML
    .trim()
    .substring(0, maxLength);
}
