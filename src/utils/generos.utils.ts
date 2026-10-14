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

/** Géneros que ofrece la app (misma grafía que `generosSoportados` en la app). */
export const GENEROS_APP = [
  'Fantasía', 'Romantasy', 'Romance', 'Dark Romance', 'Mafia Romance', 'Paranormal', 'Thriller',
  'Novela negra', 'Dark Academia', 'Drama', 'Clásicos', 'Distopía', 'Novela contemporánea',
  'Novela histórica', 'Ciencia ficción', 'Terror', 'Gótico', 'Cómic', 'No ficción', 'Infantil',
  'Juvenil', 'Poesía', 'Narrativa', 'Grimdark',
] as const;

const SIN_GENERO = 'Sin género';

// De más específico a más general: «paranormal romance» es Paranormal, no Romance.
const REGLAS_GENERO: Array<[RegExp, string]> = [
  [/romantasy/, 'Romantasy'],
  [/dark romance/, 'Dark Romance'],
  [/mafia/, 'Mafia Romance'],
  [/paranormal|vampir|werewolf|shifter/, 'Paranormal'],
  [/romance|romántic|romantic/, 'Romance'],
  [/fantasy|fantas[ií]a|dragons|magic/, 'Fantasía'],
  [/science fiction|sci-?fi|ciencia ficci/, 'Ciencia ficción'],
  [/dystopi|distop/, 'Distopía'],
  [/thriller|suspense/, 'Thriller'],
  [/mystery|crime|detective|noir|novela negra|polic[ií]aco/, 'Novela negra'],
  [/horror|terror/, 'Terror'],
  [/gothic|g[oó]tic/, 'Gótico'],
  [/historical|hist[oó]ric/, 'Novela histórica'],
  [/classic|cl[aá]sic/, 'Clásicos'],
  [/comic|graphic novel|manga/, 'Cómic'],
  [/poetry|poes[ií]a|poems/, 'Poesía'],
  [/biograph|self-help|business|economics|psychology|nonfiction|non-fiction|no ficci|cooking|religion|history/, 'No ficción'],
  [/drama/, 'Drama'],
  [/contemporary|contempor[aá]ne/, 'Novela contemporánea'],
];
// La edad del público solo manda si no hay un género de contenido más concreto.
const REGLAS_EDAD: Array<[RegExp, string]> = [
  [/children|infantil|picture book/, 'Infantil'],
  [/young adult|juvenile|juvenil|teen/, 'Juvenil'],
];

/**
 * Convierte las categorías de un catálogo externo (Google Books, OpenLibrary) a un género de la app.
 * «Fiction», «General» o «Literary Collections» solo dicen que es ficción: quedan como «Narrativa».
 * Lo que no se reconoce queda como «Sin género», en vez de crear géneros nuevos como «Boys» o
 * «England» en la base de datos.
 * Una categoría que ya es un género de la app se respeta aunque cambien las mayúsculas.
 */
export function generoDesdeCategoriasExternas(categorias: unknown): string {
  const lista = (Array.isArray(categorias) ? categorias : [categorias])
    .map((c) => String(c ?? '').trim())
    .filter(Boolean);
  const partes = lista.flatMap((c) => c.split('/')).map((p) => p.trim().toLowerCase()).filter(Boolean);
  for (const [regla, genero] of REGLAS_GENERO) {
    if (partes.some((p) => regla.test(p))) return genero;
  }
  // Nombres de la app que no tienen regla propia («Dark Academia»), con otras mayúsculas.
  for (const parte of partes) {
    const igual = GENEROS_APP.find((g) => g.toLowerCase() === parte);
    if (igual) return igual;
  }
  for (const [regla, genero] of REGLAS_EDAD) {
    if (partes.some((p) => regla.test(p))) return genero;
  }
  // «Fiction», «General»…: dicen que es ficción y nada más. Se guarda como «Narrativa» (en vez de
  // dejarlo sin género) para que luego cada persona lo concrete con otros géneros.
  if (partes.some((p) => /^(fiction|general|novel|novels|narrativa|ficci[oó]n|literary collections)$/.test(p))) {
    return 'Narrativa';
  }
  return SIN_GENERO;
}
