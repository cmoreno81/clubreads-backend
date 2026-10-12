/** Un libro tiene un género principal y, como mucho, 2 adicionales. */
export const MAX_GENEROS = 3;

/**
 * Normaliza la lista de géneros adicionales que llega del cliente: recorta,
 * quita vacíos y duplicados (también el del principal) y respeta el máximo.
 */
export function normalizarGenerosExtra(
  raw: unknown,
  principal: string,
): string[] {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>([principal.trim().toLowerCase()]);
  const out: string[] = [];
  for (const item of raw) {
    const nombre = String(item ?? '').trim().slice(0, 80);
    const clave = nombre.toLowerCase();
    if (!nombre || vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(nombre);
    if (out.length >= MAX_GENEROS - 1) break;
  }
  return out;
}

/** Principal primero, luego los adicionales: lo que se muestra al usuario. */
export function listaGeneros(book: {
  genre?: { name: string } | null;
  extraGenres: string[] | null;
}): string[] {
  const principal = book.genre?.name ?? '';
  return [principal, ...(book.extraGenres ?? [])].filter(Boolean);
}

/// Campos de «Talento emergente» que acompañan a un libro en las respuestas.
/// Los tres campos son obligatorios en el tipo para que el compilador avise
/// si una consulta con `select` se olvida de pedirlos.
export function datosTalento(book: {
  emergingTalent: boolean;
  authorNote: string | null;
  authorLinkUrl: string | null;
  authorWebUrl: string | null;
  authorSpicyLevel: number | null;
  authorTropes: string[];
}) {
  return book.emergingTalent
    ? {
        talentoEmergente: true,
        notaAutora: book.authorNote ?? '',
        enlaceAutora: book.authorLinkUrl ?? '',
        webAutora: book.authorWebUrl ?? '',
        picanteAutora: book.authorSpicyLevel,
        troposAutora: book.authorTropes,
      }
    : { talentoEmergente: false };
}
