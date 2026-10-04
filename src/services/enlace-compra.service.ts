import { prisma } from '../prisma.js';

// Programa de afiliados "Casa del Libro ES" en Awin. Ninguno de los dos
// números es secreto (viajan en cada enlace de afiliado); se pueden cambiar
// por entorno sin tocar código.
const AWIN_ADVERTISER_ID = process.env.AWIN_CASA_DEL_LIBRO_MID ?? '21491';
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID ?? '3109357';
const CASA_DEL_LIBRO_BUSQUEDA = 'https://www.casadellibro.com/?query=';

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

export function construirEnlaceCasaDelLibro(params: {
  titulo: string;
  autora?: string | null;
  isbn?: string | null;
  referencia?: string;
}) {
  const consulta =
    isbnEspanol(params.isbn) ??
    `${params.titulo} ${params.autora ?? ''}`.trim().replace(/\s+/g, ' ');

  const destino = `${CASA_DEL_LIBRO_BUSQUEDA}${encodeURIComponent(consulta)}`;

  const url = new URL('https://www.awin1.com/cread.php');
  url.searchParams.set('awinmid', AWIN_ADVERTISER_ID);
  url.searchParams.set('awinaffid', AWIN_PUBLISHER_ID);
  // clickref: etiqueta para ver en los informes de Awin desde dónde se
  // compra. Nunca datos de la usuaria.
  url.searchParams.set('clickref', params.referencia ?? 'app');
  url.searchParams.set('ued', destino);
  return url.toString();
}

export async function getEnlaceCompra(bookId: string) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: {
      title: true,
      isbn: true,
      deletedAt: true,
      author: { select: { name: true } },
    },
  });

  if (!book || book.deletedAt) {
    return { ok: false, mensaje: 'Libro no encontrado' };
  }

  return {
    ok: true,
    tienda: 'Casa del Libro',
    url: construirEnlaceCasaDelLibro({
      titulo: book.title,
      autora: book.author?.name,
      isbn: book.isbn,
      referencia: 'ficha-libro',
    }),
    aviso: AVISO_AFILIACION,
  };
}
