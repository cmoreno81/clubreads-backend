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
 * Normaliza un título para comparaciones entre el catálogo y la wishlist.
 *
 * Aplica transformaciones agresivas para que variantes del mismo libro
 * produzcan la misma cadena:
 *   - Decodifica entidades HTML          ("Mortal &amp; Inmortal" → "Mortal & Inmortal")
 *   - Elimina diacríticos                ("é" → "e")
 *   - Elimina sufijos de edición         ("Edición especial", "Edición especial limitada", …)
 *   - Elimina paréntesis con ediciones   ("(Edición limitada collector)", …)
 *   - Normaliza puntuación como espacios ("." ":" "-" "–" "—")
 *   - Colapsa espacios y pasa a minúsculas
 *
 * Ejemplo:
 *   "Zodiac Academy 1. El despertar. Edición especial"  →  "zodiac academy 1 el despertar"
 *   "Zodiac Academy 1: El despertar"                    →  "zodiac academy 1 el despertar"
 */
export function normalizeForComparison(value: string): string {
  return (
    decodeHtmlEntities(value)
      // Eliminar diacríticos
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Eliminar bloque entre paréntesis que contenga palabras de edición
      .replace(
        /\s*\((?:[^)]*\b(?:edicion|edition|limited|deluxe|collector|standard|special)\b[^)]*)\)/g,
        ' ',
      )
      // Eliminar "edición/edicion especial/limitada/de lujo" como texto suelto
      .replace(
        /\b(?:edicion|edition)\s+(?:especial|limitada|de\s+lujo|special|limited|deluxe|collector|standard)(?:\s+limitada)?\b/g,
        ' ',
      )
      // Eliminar "special/limited/deluxe edition" como texto suelto
      .replace(
        /\b(?:standard|special|limited|deluxe|collector'?s?)\s+(?:edicion|edition)\b/g,
        ' ',
      )
      // Normalizar puntuación separadora como espacio (. : - – —)
      .replace(/[.:\-–—]/g, ' ')
      // Colapsar espacios sobrantes
      .replace(/\s+/g, ' ')
      .trim()
  );
}
