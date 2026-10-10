import { StoreFormat } from '@prisma/client';
import { prisma } from '../prisma.js';

// Programa de afiliados "Casa del Libro ES" en Awin. Ninguno de los dos
// números es secreto (viajan en cada enlace de afiliado); se pueden cambiar
// por entorno sin tocar código.
const AWIN_ADVERTISER_ID = process.env.AWIN_CASA_DEL_LIBRO_MID ?? '21491';
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID ?? '3109357';
const CASA_DEL_LIBRO_BUSQUEDA = 'https://www.casadellibro.com/?query=';

// Amazon Afiliados. Sin AMAZON_ASSOCIATE_TAG (el «tracking id» que da Amazon
// al aprobar el alta) esta tienda queda apagada y nada cambia. Para
// encenderla basta con definir la variable en Railway.
const AMAZON_BUSQUEDA = 'https://www.amazon.es/s';
export const AVISO_AMAZON =
  'Como afiliado de Amazon, obtengo ingresos por las compras adscritas que cumplen los requisitos aplicables.';

export function amazonActivo() {
  return Boolean(process.env.AMAZON_ASSOCIATE_TAG?.trim());
}

/// Enlace de afiliado de Amazon por título y autora (no hay ASIN en el
/// catálogo). `papel` busca en libros; `ebook` en Kindle.
export function construirEnlaceAmazon(params: {
  titulo: string;
  autora?: string | null;
  formato: 'papel' | 'ebook';
}) {
  const url = new URL(AMAZON_BUSQUEDA);
  url.searchParams.set(
    'k',
    `${params.titulo} ${params.autora ?? ''}`.trim().replace(/\s+/g, ' '),
  );
  url.searchParams.set('i', params.formato === 'ebook' ? 'digital-text' : 'stripbooks');
  url.searchParams.set('tag', process.env.AMAZON_ASSOCIATE_TAG!.trim());
  return url.toString();
}

// Código de conducta de publicidad para influencers (2025): el contenido de
// afiliación debe identificarse como publicidad, de forma visible.
export const AVISO_AFILIACION =
  'Publicidad · Enlace de afiliado: ClubReads puede recibir una comisión si compras, sin coste extra para ti.';

// ISBN registrados en España (978-84 / 979-13): ahí la búsqueda por ISBN
// acierta con la edición de Casa del Libro. Para el resto (otras lenguas o
// ediciones extranjeras) es más fiable buscar por título y autora.
function isbnEspanol(isbn: string | null | undefined): string | null {
  const limpio = (isbn ?? '').replace(/[^0-9Xx]/g, '');
  if (limpio.length !== 13) return null;
  return limpio.startsWith('97884') || limpio.startsWith('97913')
    ? limpio
    : null;
}

const FORMATOS: Record<string, StoreFormat> = {
  papel: StoreFormat.PAPEL,
  ebook: StoreFormat.EBOOK,
  audio: StoreFormat.AUDIO,
};

export function construirEnlaceCasaDelLibro(params: {
  titulo: string;
  autora?: string | null;
  isbn?: string | null;
  referencia?: string;
  /** Ficha exacta del libro en la tienda (BookStoreLink.url); si falta se busca. */
  urlExacta?: string | null;
}) {
  // Hay ISBN erróneos en el catálogo (p. ej. uno de "Corona de medianoche"
  // llevaba a otro libro), así que de momento se busca por título + autora,
  // que no puede mandar a un libro equivocado. Cuando los ISBN estén
  // validados contra el feed de Casa del Libro, activar AWIN_BUSCAR_POR_ISBN.
  const porIsbn =
    process.env.AWIN_BUSCAR_POR_ISBN === 'true'
      ? isbnEspanol(params.isbn)
      : null;
  const consulta =
    porIsbn ??
    `${params.titulo} ${params.autora ?? ''}`.trim().replace(/\s+/g, ' ');

  const destino =
    params.urlExacta ??
    `${CASA_DEL_LIBRO_BUSQUEDA}${encodeURIComponent(consulta)}`;

  const url = new URL('https://www.awin1.com/cread.php');
  url.searchParams.set('awinmid', AWIN_ADVERTISER_ID);
  url.searchParams.set('awinaffid', AWIN_PUBLISHER_ID);
  // clickref: etiqueta para ver en los informes de Awin desde dónde se
  // compra. Nunca datos de la usuaria.
  url.searchParams.set('clickref', params.referencia ?? 'app');
  url.searchParams.set('ued', destino);
  return url.toString();
}

const ETIQUETA: Record<StoreFormat, string> = {
  PAPEL: 'Papel',
  EBOOK: 'Ebook',
  AUDIO: 'Audiolibro',
};
const ORDEN: StoreFormat[] = [
  StoreFormat.PAPEL,
  StoreFormat.EBOOK,
  StoreFormat.AUDIO,
];
// Formato de lectura de la usuaria -> formato de la tienda.
const DESDE_LECTURA: Record<string, StoreFormat> = {
  PHYSICAL: StoreFormat.PAPEL,
  DIGITAL: StoreFormat.EBOOK,
  AUDIOBOOK: StoreFormat.AUDIO,
};

const SELECT_ENLACE = {
  title: true,
  isbn: true,
  language: true,
  deletedAt: true,
  author: { select: { name: true } },
  storeLinks: {
    where: { store: 'CASA_DEL_LIBRO' },
    select: { format: true, url: true, language: true },
  },
  // Libros traídos de novedades/próximos lanzamientos: ya llevan la ficha
  // exacta de Casa del Libro, aunque aún no estén en el feed.
  sources: {
    where: { sourceUrl: { contains: 'casadellibro.com/libro-' } },
    select: { sourceUrl: true },
    orderBy: { lastCheckedAt: 'desc' as const },
    take: 1,
  },
} as const;

type LibroEnlace = {
  title: string;
  isbn: string | null;
  language: string | null;
  author: { name: string } | null;
  storeLinks: { format: StoreFormat; url: string; language: string }[];
  sources: { sourceUrl: string }[];
};

type LecturaUsuario = {
  readingFormat: string | null;
  personalLanguage: string | null;
} | null;

// Siempre se ofrece la edición en español, salvo que la usuaria tenga el
// libro en otro idioma (el suyo propio o, si no lo fijó, el del libro).
function idiomaDeseado(book: LibroEnlace, lectura: LecturaUsuario | undefined) {
  if (!lectura) return 'es';
  return (lectura.personalLanguage ?? book.language ?? 'es').toLowerCase();
}

function resolverEnlace(
  book: LibroEnlace,
  pedido: StoreFormat | undefined,
  lectura: LecturaUsuario | undefined,
) {
  const idioma = idiomaDeseado(book, lectura);
  // Formato principal: el pedido, o el que usa la usuaria en su biblioteca
  // (si ya tiene el libro) y, si no, papel.
  const principal =
    pedido ??
    (lectura?.readingFormat ? DESDE_LECTURA[lectura.readingFormat] : undefined) ??
    StoreFormat.PAPEL;

  const enlace = (urlExacta?: string | null) =>
    construirEnlaceCasaDelLibro({
      titulo: book.title,
      autora: book.author?.name,
      isbn: book.isbn,
      referencia: 'ficha-libro',
      urlExacta,
    });

  const porFormato = new Map(
    book.storeLinks.filter((l) => l.language === idioma).map((l) => [l.format, l.url]),
  );
  // Las fichas de novedades son ediciones en español.
  const deNovedades = book.sources[0]?.sourceUrl;
  if (idioma === 'es' && deNovedades && !porFormato.has(StoreFormat.PAPEL)) {
    porFormato.set(StoreFormat.PAPEL, deNovedades);
  }

  // Si el formato principal no está en la tienda se cae a papel, luego al
  // primero disponible y, si no hay ninguno, a la búsqueda por título y autora.
  const disponible = ORDEN.filter((f) => porFormato.has(f));
  const elegido = porFormato.has(principal)
    ? principal
    : porFormato.has(StoreFormat.PAPEL)
      ? StoreFormat.PAPEL
      : disponible[0];

  const casaDelLibro = {
    tienda: 'Casa del Libro',
    url: enlace(elegido ? porFormato.get(elegido) : null),
    exacto: Boolean(elegido),
    formato: (elegido ?? StoreFormat.PAPEL).toLowerCase(),
    formatos: disponible.map((f) => ({
      formato: f.toLowerCase(),
      etiqueta: ETIQUETA[f],
      url: enlace(porFormato.get(f)),
    })),
    aviso: AVISO_AFILIACION,
  };

  // Amazon, si está activo: papel y Kindle, buscando por título y autora.
  // Las apps antiguas solo entienden una tienda y la llaman «Casa del Libro»,
  // así que el nivel superior de la respuesta sigue siendo SOLO Casa del
  // Libro; Amazon va únicamente en `tiendas`, que leen las apps nuevas.
  const tiendas = [casaDelLibro];
  if (amazonActivo()) {
    const amazon = (formato: 'papel' | 'ebook') =>
      construirEnlaceAmazon({ titulo: book.title, autora: book.author?.name, formato });
    const preferido = principal === StoreFormat.EBOOK ? 'ebook' : 'papel';
    const tiendaAmazon = {
      tienda: 'Amazon',
      url: amazon(preferido),
      exacto: true,
      formato: preferido,
      formatos: [
        { formato: 'papel', etiqueta: 'Papel', url: amazon('papel') },
        { formato: 'ebook', etiqueta: 'Kindle', url: amazon('ebook') },
      ],
      aviso: `${AVISO_AFILIACION} ${AVISO_AMAZON}`,
    };
    // Casa del Libro primero si tiene el libro; si no, Amazon pasa delante.
    if (casaDelLibro.exacto) tiendas.push(tiendaAmazon);
    else tiendas.unshift(tiendaAmazon);
  }

  return { ...casaDelLibro, tiendas };
}

export async function getEnlaceCompra(
  bookId: string,
  formato = '',
  userId?: string,
) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: SELECT_ENLACE,
  });

  if (!book || book.deletedAt) {
    return { ok: false, mensaje: 'Libro no encontrado' };
  }

  const lib = userId
    ? await prisma.library.findFirst({
        where: { userId, bookId },
        select: {
          readingFormat: true,
          personalLanguage: true,
          status: true,
          owned: true,
        },
      })
    : null;
  const loTengo = userId
    ? Boolean(lib?.owned) || (await tieneDeseoComprado(userId, [bookId])).has(bookId)
    : false;

  return {
    ok: true,
    // La lectora ya tiene el libro (lo marcó, o compró el deseo): no se le
    // ofrece comprarlo, pero el libro sigue donde estaba.
    loTengo,
    // El libro está en su biblioteca: solo entonces se puede marcar.
    enBiblioteca: Boolean(lib),
    // La lectora ya ha empezado o terminado el libro (no solo lo tiene
    // pendiente): no hace falta ofrecerle comprarlo.
    yaEmpezado: Boolean(lib && lib.status !== 'PENDING'),
    ...resolverEnlace(book, FORMATOS[formato.toLowerCase()], lib),
  };
}

/// Enlaces de varios libros de una vez (página "Tu próxima compra").
export async function getEnlacesCompraLote(bookIds: string[], userId?: string) {
  const ids = [...new Set(bookIds.filter(Boolean))].slice(0, 80);
  const [books, libs] = await Promise.all([
    prisma.book.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, ...SELECT_ENLACE },
    }),
    userId
      ? prisma.library.findMany({
          where: { userId, bookId: { in: ids } },
          select: {
            bookId: true,
            readingFormat: true,
            personalLanguage: true,
            owned: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const lectura = new Map(libs.map((l) => [l.bookId, l]));
  const comprados = userId ? await tieneDeseoComprado(userId, ids) : new Set<string>();
  const enlaces: Record<
    string,
    ReturnType<typeof resolverEnlace> & { loTengo: boolean }
  > = {};
  for (const b of books) {
    enlaces[b.id] = {
      ...resolverEnlace(b, undefined, lectura.get(b.id) ?? null),
      loTengo: Boolean(lectura.get(b.id)?.owned) || comprados.has(b.id),
    };
  }
  return { ok: true, enlaces, aviso: amazonActivo() ? `${AVISO_AFILIACION} ${AVISO_AMAZON}` : AVISO_AFILIACION };
}

/// Libros de la lista cuyo deseo ya se marcó como comprado.
async function tieneDeseoComprado(userId: string, bookIds: string[]) {
  const filas = await prisma.wishlistItem.findMany({
    where: { userId, bookId: { in: bookIds }, purchasedAt: { not: null } },
    select: { bookId: true },
  });
  return new Set(filas.map((f) => f.bookId).filter((id): id is string => Boolean(id)));
}

/// Marca (o desmarca) "Ya lo tengo" en la biblioteca de la lectora. Solo
/// apaga los botones de compra: no toca estado, lectura ni estadísticas.
export async function setLoTengo(userId: string, bookId: string, owned: boolean) {
  const { count } = await prisma.library.updateMany({
    where: { userId, bookId },
    // La fecha solo se pone al marcar; al desmarcar se borra.
    data: { owned, ownedAt: owned ? new Date() : null },
  });
  if (count === 0) {
    return { ok: false, mensaje: 'Este libro no está en tu biblioteca.' };
  }
  return { ok: true, loTengo: owned };
}
