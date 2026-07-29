import {
  Priority,
  ReadingFormat,
  ReadingStatus,
} from '@prisma/client';

import { prisma } from '../prisma.js';

type ExternalVolume = {
  id?: unknown;
  volumeInfo?: {
    title?: unknown;
    authors?: unknown;
    categories?: unknown;
    industryIdentifiers?: unknown;
    imageLinks?: unknown;
    pageCount?: unknown;
    publishedDate?: unknown;
  };
};

type OpenLibraryDoc = {
  key?: unknown;
  title?: unknown;
  author_name?: unknown;
  isbn?: unknown;
  cover_i?: unknown;
  first_publish_year?: unknown;
  number_of_pages_median?: unknown;
  subject?: unknown;
};

const bookInclude = {
  author: true,
  genre: true,
  library: true,
} as const;

function priorityFromFlutter(value: unknown): Priority {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'ALTA' || normalized === 'HIGH') return Priority.HIGH;
  if (normalized === 'BAJA' || normalized === 'LOW') return Priority.LOW;
  return Priority.MEDIUM;
}

function formatFromFlutter(value: unknown): ReadingFormat | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (['FISICO', 'FÍSICO', 'PHYSICAL'].includes(normalized)) {
    return ReadingFormat.PHYSICAL;
  }
  if (normalized === 'DIGITAL') return ReadingFormat.DIGITAL;
  if (['AUDIOLIBRO', 'AUDIOBOOK'].includes(normalized)) {
    return ReadingFormat.AUDIOBOOK;
  }
  return null;
}

function statusToFlutter(status: ReadingStatus | undefined) {
  const values: Partial<Record<ReadingStatus, string>> = {
    [ReadingStatus.PENDING]: 'PENDIENTE',
    [ReadingStatus.READING]: 'LEYENDO',
    [ReadingStatus.PAUSED]: 'PAUSADO',
    [ReadingStatus.FINISHED]: 'FINALIZADO',
    [ReadingStatus.ABANDONED]: 'ABANDONADO',
    [ReadingStatus.REREADING]: 'RELECTURA',
  };
  return status ? values[status] ?? '' : '';
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/\s+/g, ' ');
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
}

function localBook(book: {
  id: string;
  title: string;
  isbn: string | null;
  coverUrl: string | null;
  publicationYear: number | null;
  totalPages: number | null;
  author: { name: string } | null;
  genre: { name: string };
  library: Array<{ userId: string; status: ReadingStatus }>;
}, userId: string) {
  const own = book.library.find((item) => item.userId === userId);
  return {
    id: book.id,
    origen: 'CLUBREADS',
    titulo: book.title,
    autores: book.author ? [book.author.name] : [],
    coverUrl: book.coverUrl ?? '',
    genero: book.genre.name,
    isbn: book.isbn ?? '',
    paginas: book.totalPages,
    anioPublicacion: book.publicationYear,
    enMiBiblioteca: Boolean(own),
    estado: statusToFlutter(own?.status),
  };
}

function externalBook(item: ExternalVolume) {
  const info = item.volumeInfo ?? {};
  const identifiers = Array.isArray(info.industryIdentifiers)
    ? info.industryIdentifiers as Array<{ type?: unknown; identifier?: unknown }>
    : [];
  const isbn =
    identifiers.find((value) => value.type === 'ISBN_13')?.identifier ??
    identifiers.find((value) => value.type === 'ISBN_10')?.identifier ??
    '';
  const images = (info.imageLinks ?? {}) as {
    thumbnail?: unknown;
    smallThumbnail?: unknown;
  };
  const published = String(info.publishedDate ?? '');
  return {
    id: String(item.id ?? ''),
    origen: 'GOOGLE',
    titulo: String(info.title ?? '').trim(),
    autores: stringList(info.authors),
    coverUrl: String(images.thumbnail ?? images.smallThumbnail ?? '')
      .replace(/^http:/, 'https:'),
    genero: stringList(info.categories)[0] ?? 'Sin género',
    isbn: String(isbn),
    paginas: Number.isInteger(info.pageCount) ? info.pageCount : null,
    anioPublicacion: /^\d{4}/.test(published)
      ? Number(published.slice(0, 4))
      : null,
    enMiBiblioteca: false,
    estado: '',
  };
}

function openLibraryBook(item: OpenLibraryDoc) {
  const isbns = stringList(item.isbn);
  const isbn =
    isbns.find((value) => value.replace(/[^0-9Xx]/g, '').length === 13) ??
    isbns[0] ??
    '';
  const coverId = Number(item.cover_i);
  return {
    id: String(item.key ?? '').replace(/^\/works\//, ''),
    origen: 'OPENLIBRARY',
    titulo: String(item.title ?? '').trim(),
    autores: stringList(item.author_name),
    coverUrl: Number.isInteger(coverId) && coverId > 0
      ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
      : '',
    genero: stringList(item.subject)[0] ?? 'Sin género',
    isbn,
    paginas: Number.isInteger(item.number_of_pages_median)
      ? item.number_of_pages_median
      : null,
    anioPublicacion: Number.isInteger(item.first_publish_year)
      ? item.first_publish_year
      : null,
    enMiBiblioteca: false,
    estado: '',
  };
}

async function searchOpenLibrary(query: string) {
  try {
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '20');
    url.searchParams.set(
      'fields',
      'key,title,author_name,isbn,cover_i,first_publish_year,number_of_pages_median,subject',
    );
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ClubReads/1.0 (book catalog search)',
      },
    });
    if (!response.ok) return [];
    const payload = await response.json() as { docs?: OpenLibraryDoc[] };
    return (payload.docs ?? [])
      .map(openLibraryBook)
      .filter((book) => book.id && book.titulo);
  } catch {
    return [];
  }
}

async function authenticatedUser(userName: string) {
  const user = await prisma.user.findUnique({
    where: { name: userName.trim() },
  });
  if (!user) throw new Error('Usuaria no encontrada');
  return user;
}

export async function getGeneralCatalog(userName: string) {
  const user = await authenticatedUser(userName);
  const books = await prisma.book.findMany({
    include: bookInclude,
    orderBy: [{ library: { _count: 'desc' } }, { createdAt: 'desc' }],
    take: 30,
  });
  return { ok: true, libros: books.map((book) => localBook(book, user.id)) };
}

export async function searchGeneralCatalog(userName: string, rawQuery: string) {
  const user = await authenticatedUser(userName);
  const query = rawQuery.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (query.length < 2) {
    return { ok: false, mensaje: 'Escribe al menos dos caracteres', libros: [] };
  }

  const local = await prisma.book.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { isbn: { contains: query, mode: 'insensitive' } },
        { author: { name: { contains: query, mode: 'insensitive' } } },
      ],
    },
    include: bookInclude,
    take: 20,
  });

  let external: Array<ReturnType<typeof externalBook> | ReturnType<typeof openLibraryBook>> = [];
  let googleAvailable = false;
  try {
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '20');
    url.searchParams.set('printType', 'books');
    if (process.env.GOOGLE_BOOKS_API_KEY) {
      url.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY);
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      googleAvailable = true;
      const payload = await response.json() as { items?: ExternalVolume[] };
      external = (payload.items ?? [])
        .map(externalBook)
        .filter((book) => book.id && book.titulo);
    }
  } catch {
    // La búsqueda local sigue disponible si el proveedor externo no responde.
  }
  if (!googleAvailable || external.length === 0) {
    external = await searchOpenLibrary(query);
  }

  const localItems = local.map((book) => localBook(book, user.id));
  const existingKeys = new Set(
    localItems.flatMap((book) => [
      book.isbn ? `isbn:${book.isbn}` : '',
      `title:${normalize(book.titulo)}:${normalize(book.autores[0] ?? '')}`,
    ]).filter(Boolean),
  );
  const uniqueExternal = external.filter((book) => {
    const keys = [
      book.isbn ? `isbn:${book.isbn}` : '',
      `title:${normalize(book.titulo)}:${normalize(book.autores[0] ?? '')}`,
    ].filter(Boolean);
    if (keys.some((key) => existingKeys.has(key))) return false;
    keys.forEach((key) => existingKeys.add(key));
    return true;
  });

  return { ok: true, libros: [...localItems, ...uniqueExternal] };
}

export async function importCatalogBook(
  userName: string,
  data: Record<string, unknown>,
) {
  const user = await authenticatedUser(userName);
  const resolved = await resolveCatalogBook(user.id, data);
  if (!resolved.ok) return resolved;
  const book = resolved.book;

  const existing = await prisma.library.findUnique({
    where: { userId_bookId: { userId: user.id, bookId: book.id } },
  });
  if (existing) {
    return {
      ok: true,
      codigo: 'LIBRO_YA_EN_BIBLIOTECA',
      mensaje: 'Este libro ya está en tu biblioteca',
      libro: { id: book.id, titulo: book.title },
    };
  }
  await prisma.library.create({
    data: {
      userId: user.id,
      bookId: book.id,
      status: ReadingStatus.PENDING,
      priority: priorityFromFlutter(data.prioridad),
      readingFormat: formatFromFlutter(data.formato),
    },
  });
  return {
    ok: true,
    codigo: 'LIBRO_CATALOGO_ANADIDO',
    mensaje: 'Libro añadido a tu biblioteca',
    libro: { id: book.id, titulo: book.title },
  };
}

async function resolveCatalogBook(
  userId: string,
  data: Record<string, unknown>,
) {
  const source = String(data.origen ?? '').toUpperCase();
  const title = String(data.titulo ?? '').trim().replace(/\s+/g, ' ');
  const authors = stringList(data.autores);
  const isbn = String(data.isbn ?? '').trim().replace(/[^0-9Xx]/g, '');
  if (!title || !['CLUBREADS', 'GOOGLE', 'OPENLIBRARY'].includes(source)) {
    return {
      ok: false as const,
      mensaje: 'El libro seleccionado no es válido',
    };
  }

  let book = source === 'CLUBREADS'
    ? await prisma.book.findUnique({ where: { id: String(data.id ?? '') } })
    : null;

  if (!book && isbn) {
    book = await prisma.book.findFirst({ where: { isbn } });
  }
  if (!book) {
    const candidates = await prisma.book.findMany({
      where: { title: { equals: title, mode: 'insensitive' } },
      include: { author: true },
      take: 10,
    });
    book = candidates.find((candidate) =>
      normalize(candidate.author?.name ?? '') === normalize(authors[0] ?? '')
    ) ?? null;
  }

  if (!book && source !== 'CLUBREADS') {
    const genreName = String(data.genero ?? '').trim() || 'Sin género';
    const authorName = authors[0] || 'Autor desconocido';
    const [genre, author] = await Promise.all([
      prisma.genre.upsert({
        where: { name: genreName },
        update: {},
        create: { name: genreName },
      }),
      prisma.author.upsert({
        where: { name: authorName },
        update: {},
        create: { name: authorName },
      }),
    ]);
    const pages = Number(data.paginas);
    const year = Number(data.anioPublicacion);
    book = await prisma.book.create({
      data: {
        title,
        authorId: author.id,
        genreId: genre.id,
        isbn: isbn || null,
        coverUrl: String(data.coverUrl ?? '').trim() || null,
        totalPages: Number.isInteger(pages) && pages > 0 ? pages : null,
        publicationYear: Number.isInteger(year) && year > 0 ? year : null,
        standalone: true,
        createdById: userId,
      },
    });
  }
  if (!book) {
    return { ok: false as const, mensaje: 'Libro no encontrado' };
  }
  return { ok: true as const, book };
}

export async function addSeriesCatalogVolume(
  userName: string,
  data: Record<string, unknown>,
) {
  const user = await authenticatedUser(userName);
  const seriesId = String(data.sagaId ?? '').trim();
  const order = String(data.numero ?? '').trim().replace(',', '.');
  const parsedOrder = Number.parseFloat(order);
  if (!seriesId || !Number.isFinite(parsedOrder) || parsedOrder <= 0) {
    return { ok: false, mensaje: 'Indica un número de volumen válido' };
  }
  const series = await prisma.series.findUnique({ where: { id: seriesId } });
  if (!series) return { ok: false, mensaje: 'Saga no encontrada' };

  const resolved = await resolveCatalogBook(user.id, data);
  if (!resolved.ok) return resolved;
  const book = await prisma.book.update({
    where: { id: resolved.book.id },
    data: {
      seriesId: series.id,
      seriesOrder: order,
      standalone: false,
    },
  });
  const knownOrders = await prisma.book.findMany({
    where: { seriesId: series.id, deletedAt: null },
    select: { seriesOrder: true },
  });
  const highestOrder = knownOrders.reduce((highest, item) => {
    const value = Number.parseFloat(item.seriesOrder ?? '');
    return Number.isFinite(value) ? Math.max(highest, Math.ceil(value)) : highest;
  }, 0);
  if ((series.totalBooks ?? 0) < highestOrder) {
    await prisma.series.update({
      where: { id: series.id },
      data: { totalBooks: highestOrder },
    });
  }
  return {
    ok: true,
    codigo: 'VOLUMEN_SAGA_VINCULADO',
    mensaje: 'Volumen añadido al catálogo de la saga',
    libro: { id: book.id, titulo: book.title },
  };
}
