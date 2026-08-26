/**
 * Utilidades de normalización de texto.
 *
 * Centralizamos aquí la decodificación de entidades HTML y la limpieza de
 * espacios para que todos los servicios usen la misma lógica y no se
 * cuelen "&amp;" ni otros artefactos HTML en la base de datos.
 */

/**
 * Decodifica las entidades HTML más habituales que pueden aparecer en títulos
 * y autores procedentes de scraping (og:title, book:author, etc.).
 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&nbsp;', ' ');
}

/**
 * Limpia un string de texto: decodifica entidades HTML y colapsa espacios.
 * Usar siempre antes de persistir títulos, autores y géneros en BD.
 */
export function cleanText(value: string): string {
  return decodeHtmlEntities(value).trim().replace(/\s+/g, ' ');
}

/** Igual que cleanText pero acepta null/undefined y devuelve null si vacío. */
export function cleanTextNullable(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = cleanText(value);
  return cleaned || null;
}

/**
 * Normaliza un título para comparaciones: limpia HTML, pasa a minúsculas
 * y elimina diacríticos. Usar para detectar duplicados o coincidencias.
 */
export function normalizeForComparison(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .trim();
}
