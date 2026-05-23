/**
 * Utilidades para validar seguridad de URLs y datos
 */

export function isSecureUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateRepoUrlSecurity(url: string): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!isSecureUrl(url)) {
    issues.push('La URL debe usar HTTPS para garantizar seguridad');
  }

  try {
    const parsedUrl = new URL(url);
    
    // Lista de dominios confiables (opcional)
    const trustedDomains = [
      'github.com',
      'raw.githubusercontent.com',
      'gitlab.com',
    ];

    const isTrustedDomain = trustedDomains.some(domain => 
      parsedUrl.hostname.endsWith(domain)
    );

    if (!isTrustedDomain) {
      issues.push('Advertencia: Repositorio de fuente desconocida');
    }

  } catch (error) {
    issues.push('URL malformada');
  }

  return {
    isValid: issues.filter(i => !i.includes('Advertencia')).length === 0,
    issues,
  };
}
