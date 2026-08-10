import {
  Priority,
  ReadingFormat,
  ReadingStatus,
  SeriesPublicationStatus,
} from '@prisma/client';

import { prisma } from '../prisma.js';
import { notifyLibroNuevoBiblioteca } from './notifications.service.js';
import { validateReadingTransitionInput } from '../utils/reading-transition.utils.js';
import {
  findBookByIdentity,
  lockBookIdentity,
  resolveCanonicalBookId,
} from './book-identity.service.js';
import {
  descendingCursorFilter,
  pageFromRows,
  type PaginationRequest,
} from '../utils/cursor-pagination.js';
import { observeExternalCall } from '../logging/external-call.js';
import { backgroundError } from '../logging/logger.js';
import {
  normalizePriority,
  normalizeReadingFormat,
  normalizeReadingStatus,
} from '../validation/api-enums.js';

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

async function notifyLibraryAddition(
  user: { id: string; name: string },
  book: { id: string; title: string },
) {
  const memberships = await prisma.clubMember.findMany({
    where: { userId: user.id },
    select: { clubId: true },
  });
  for (const membership of memberships) {
    await notifyLibroNuevoBiblioteca({
      clubId: membership.clubId,
      autoraNombre: user.name,
      autoraUserId: user.id,
      libros: [book],
    });
  }
}

function priorityFromFlutter(value: unknown): Priority {
  const normalized = normalizePriority(value);
  if (normalized === 'HIGH') return Priority.HIGH;
  if (normalized === 'LOW') return Priority.LOW;
  return Priority.MEDIUM;
}

function formatFromFlutter(value: unknown): ReadingFormat | null {
  const normalized = normalizeReadingFormat(value);
  if (normalized === 'PHYSICAL') return ReadingFormat.PHYSICAL;
  if (normalized === 'DIGITAL') return ReadingFormat.DIGITAL;
  if (normalized === 'AUDIOBOOK') return ReadingFormat.AUDIOBOOK;
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

export function canonicalBookTitle(value: string) {
  return normalize(value)
    .replace(/^.*\b(?:trilogy|trilogia|trilogía|saga)\b\s*:\s*/, '')
    .replace(
      /\((?:[^)]*\b(?:edition|edicion|edición|limited|deluxe|collector|standard|special)\b[^)]*)\)/g,
      ' ',
    )
    .replace(
      /\b(?:standard|special|limited|deluxe|collector'?s?)\s+(?:edition|edicion)\b/g,
      ' ',
    )
    .replace(/\b(?:edicion|edición)\s+(?:especial|limitada|de lujo)\b/g, ' ')
    .replace(/\s*[:\-–—]\s*(?:standard|special|limited|deluxe)\b.*$/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function identityKeys(book: {
  isbn: string;
  titulo: string;
  autores: string[];
}) {
  return [
    book.isbn ? `isbn:${book.isbn.replace(/[^0-9Xx]/g, '')}` : '',
    `work:${canonicalBookTitle(book.titulo)}:${normalize(book.autores[0] ?? '')}`,
  ].filter(Boolean);
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
  library: Array<{
    userId: string;
    status: ReadingStatus;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>;
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
    fechaInicio: own?.startedAt?.toISOString() ?? null,
    fechaFin: own?.finishedAt?.toISOString() ?? null,
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
    const response = await observeExternalCall('open_library', 'catalog_search', () => fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ClubReads/1.0 (book catalog search)',
      },
    }));
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

export async function getGeneralCatalogPage(
  userName: string,
  pagination: PaginationRequest,
) {
  const user = await authenticatedUser(userName);
  const rows = await prisma.book.findMany({
    where: {
      deletedAt: null,
      ...descendingCursorFilter('createdAt', pagination.cursor),
    },
    select: {
      id: true,
      title: true,
      isbn: true,
      coverUrl: true,
      publicationYear: true,
      totalPages: true,
      createdAt: true,
      author: { select: { name: true } },
      genre: { select: { name: true } },
      library: {
        where: { userId: user.id },
        select: {
          userId: true,
          status: true,
          startedAt: true,
          finishedAt: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });
  const page = pageFromRows(rows, pagination.limit, (book) => ({
    value: book.createdAt.toISOString(),
    id: book.id,
  }));
  return {
    ...page,
    items: page.items.map((book) => localBook(book, user.id)),
  };
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
    const response = await observeExternalCall('google_books', 'catalog_search', () => fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    }));
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

  const localItems = local
    .map((book) => localBook(book, user.id))
    .sort((left, right) => Number(right.enMiBiblioteca) - Number(left.enMiBiblioteca));
  const existingKeys = new Set<string>();
  const uniqueLocal = localItems.filter((book) => {
    const keys = identityKeys(book);
    if (keys.some((key) => existingKeys.has(key))) return false;
    keys.forEach((key) => existingKeys.add(key));
    return true;
  });
  const uniqueExternal = external.filter((book) => {
    const keys = identityKeys(book);
    if (keys.some((key) => existingKeys.has(key))) return false;
    keys.forEach((key) => existingKeys.add(key));
    return true;
  });

  return { ok: true, libros: [...uniqueLocal, ...uniqueExternal] };
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
  void notifyLibraryAddition(user, book).catch(backgroundError('library_addition_notification_failed'));
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

  const requestedId = String(data.id ?? '');
  const canonicalId = source === 'CLUBREADS' && requestedId
    ? await resolveCanonicalBookId(prisma, requestedId)
    : requestedId;
  let book = source === 'CLUBREADS'
    ? await prisma.book.findFirst({ where: { id: canonicalId, deletedAt: null } })
    : null;

  if (!book) book = await findBookByIdentity(prisma, {
    title,
    authorName: authors[0] || 'Autor desconocido',
    isbn,
  });

  if (!book && source !== 'CLUBREADS') {
    const genreName = String(data.genero ?? '').trim() || 'Sin género';
    const authorName = authors[0] || 'Autor desconocido';
    const pages = Number(data.paginas);
    const year = Number(data.anioPublicacion);
    book = await prisma.$transaction(async (tx) => {
      const identity = { title, authorName, isbn };
      await lockBookIdentity(tx, identity);
      const existing = await findBookByIdentity(tx, identity);
      if (existing) return existing;
      const [genre, author] = await Promise.all([
        tx.genre.upsert({ where: { name: genreName }, update: {}, create: { name: genreName } }),
        tx.author.upsert({ where: { name: authorName }, update: {}, create: { name: authorName } }),
      ]);
      return tx.book.create({
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
  const statusWasProvided = Object.prototype.hasOwnProperty.call(data, 'estado') &&
    String(data.estado ?? '').trim().length > 0;
  const formatWasProvided = Object.prototype.hasOwnProperty.call(data, 'formato');
  const requestedStatus = statusWasProvided
    ? normalizeReadingStatus(data.estado) as ReadingStatus | null
    : undefined;
  if (statusWasProvided && !requestedStatus) {
    return { ok: false, mensaje: 'El estado indicado no es válido' };
  }
  const requestedFormat = formatFromFlutter(data.formato);
  if (formatWasProvided && String(data.formato ?? '').trim() && !requestedFormat) {
    return { ok: false, mensaje: 'El formato indicado no es válido' };
  }
  const now = new Date();
  const transition = validateReadingTransitionInput({
    status: requestedStatus ?? ReadingStatus.PENDING,
    valoracion: data.valoracion,
    fechaInicio: data.fechaInicio,
    fechaFin: data.fechaFin,
    now,
  });
  if (!transition.ok) return transition;
  if (!seriesId || !Number.isFinite(parsedOrder) || parsedOrder <= 0) {
    return { ok: false, mensaje: 'Indica un número de volumen válido' };
  }
  const series = await prisma.series.findUnique({ where: { id: seriesId } });
  if (!series) return { ok: false, mensaje: 'Saga no encontrada' };

  const resolved = await resolveCatalogBook(user.id, data);
  if (!resolved.ok) return resolved;
  const requestedPosition = seriesPosition(order);
  const transactionResult = await prisma.$transaction(async (tx) => {
    const seriesBooks = await tx.book.findMany({
      where: { seriesId: series.id, id: { not: resolved.book.id }, deletedAt: null },
    });
    const occupied = seriesBooks.find((item) => seriesPosition(item.seriesOrder) === requestedPosition);
    if (occupied) return { occupied, book: null, existingLibrary: null };
    const book = await tx.book.update({
      where: { id: resolved.book.id },
      data: { seriesId: series.id, seriesOrder: order, standalone: false },
    });
    const existingLibrary = await tx.library.findUnique({
      where: { userId_bookId: { userId: user.id, bookId: book.id } },
    });
    const effectiveStatus = requestedStatus ?? existingLibrary?.status ?? ReadingStatus.PENDING;
    const statusDates = effectiveStatus === ReadingStatus.READING
      ? {
          startedAt: transition.startDate ?? existingLibrary?.startedAt ?? now,
          finishedAt: null,
          pausedAt: null,
          pauseReason: null,
        }
      : effectiveStatus === ReadingStatus.FINISHED
        ? {
            startedAt: transition.startDate ?? existingLibrary?.startedAt ?? now,
            finishedAt: transition.endDate ?? existingLibrary?.finishedAt ?? now,
            pausedAt: null,
            pauseReason: null,
          }
        : {
            startedAt: null,
            finishedAt: null,
            pausedAt: null,
            pauseReason: null,
          };
    await tx.library.upsert({
      where: { userId_bookId: { userId: user.id, bookId: book.id } },
      update: {
        ...(statusWasProvided ? { status: effectiveStatus, ...statusDates } : {}),
        ...(formatWasProvided ? { readingFormat: requestedFormat } : {}),
      },
      create: {
        userId: user.id,
        bookId: book.id,
        status: effectiveStatus,
        priority: Priority.MEDIUM,
        readingFormat: requestedFormat,
        ...statusDates,
      },
    });
    if (
      statusWasProvided &&
      effectiveStatus === ReadingStatus.FINISHED &&
      existingLibrary?.status !== ReadingStatus.FINISHED
    ) {
      await tx.readingCompletion.create({
        data: {
          userId: user.id,
          bookId: book.id,
          startedAt: statusDates.startedAt,
          finishedAt: statusDates.finishedAt as Date,
          isReread: false,
          rating: transition.rating as number,
          readingFormat: requestedFormat ?? existingLibrary?.readingFormat,
        },
      });
      await tx.review.upsert({
        where: { userId_bookId: { userId: user.id, bookId: book.id } },
        update: { rating: transition.rating as number, deletedAt: null },
        create: { userId: user.id, bookId: book.id, rating: transition.rating as number },
      });
    }
    if (Number.isInteger(requestedPosition)) {
      await tx.seriesBookOverride.deleteMany({
        where: { userId: user.id, seriesId: series.id, posicion: requestedPosition },
      });
    }
    const knownOrders = await tx.book.findMany({
      where: { seriesId: series.id, deletedAt: null },
      select: { seriesOrder: true },
    });
    const highestOrder = knownOrders.reduce((highest, item) => {
      const value = seriesPosition(item.seriesOrder);
      return Number.isFinite(value) ? Math.max(highest, Math.ceil(value)) : highest;
    }, 0);
    if ((series.totalBooks ?? 0) < highestOrder) {
      await tx.series.update({ where: { id: series.id }, data: { totalBooks: highestOrder } });
    }
    return { occupied: null, book, existingLibrary };
  });
  if (transactionResult.occupied) {
    return {
      ok: false,
      codigo: 'NUMERO_SAGA_OCUPADO',
      mensaje: `El volumen ${order} ya corresponde a ${transactionResult.occupied.title}`,
    };
  }
  const book = transactionResult.book!;
  const existingLibrary = transactionResult.existingLibrary;
  if (!existingLibrary) {
    void notifyLibraryAddition(user, book).catch(backgroundError('library_addition_notification_failed'));
  }
  return {
    ok: true,
    codigo: 'VOLUMEN_SAGA_VINCULADO',
    mensaje: 'Volumen añadido a la saga y a tu biblioteca',
    libro: { id: book.id, titulo: book.title },
  };
}

export async function updateSeriesVolumeOrder(
  userName: string,
  data: Record<string, unknown>,
) {
  await authenticatedUser(userName);
  const bookId = String(data.bookId ?? '').trim();
  const order = String(data.numero ?? '').trim().replace(',', '.');
  const parsedOrder = Number.parseFloat(order);
  if (!bookId || !Number.isFinite(parsedOrder) || parsedOrder <= 0) {
    return { ok: false, mensaje: 'Indica un número de volumen válido' };
  }
  const canonicalBookId = await resolveCanonicalBookId(prisma, bookId);
  const book = await prisma.book.findFirst({ where: { id: canonicalBookId, deletedAt: null } });
  if (!book?.seriesId) {
    return { ok: false, mensaje: 'El libro no pertenece a una saga' };
  }
  const seriesBooks = await prisma.book.findMany({
    where: {
      seriesId: book.seriesId,
      id: { not: book.id },
      deletedAt: null,
    },
  });
  const requestedPosition = seriesPosition(order);
  const occupied = seriesBooks.find(
    (item) => seriesPosition(item.seriesOrder) === requestedPosition,
  );
  if (occupied) {
    return {
      ok: false,
      codigo: 'NUMERO_SAGA_OCUPADO',
      mensaje: `El volumen ${order} ya corresponde a ${occupied.title}`,
    };
  }
  await prisma.book.update({
    where: { id: book.id },
    data: { seriesOrder: order, standalone: false },
  });
  return {
    ok: true,
    mensaje: 'Número de volumen actualizado',
  };
}

export async function updateSeriesPublicationStatus(
  userName: string,
  data: Record<string, unknown>,
) {
  await authenticatedUser(userName);
  const seriesId = String(data.sagaId ?? '').trim();
  const status = String(data.estadoEditorial ?? '').trim().toUpperCase();
  const allowed = new Set(Object.values(SeriesPublicationStatus));
  if (!seriesId || !allowed.has(status as SeriesPublicationStatus)) {
    return { ok: false, mensaje: 'Selecciona un estado editorial válido' };
  }

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: { books: { where: { deletedAt: null } } },
  });
  if (!series) return { ok: false, mensaje: 'Saga no encontrada' };

  const rawTotal = data.totalPrevisto;
  const total = rawTotal == null || String(rawTotal).trim() === ''
    ? null
    : Number.parseInt(String(rawTotal), 10);
  const highestPosition = series.books.reduce((highest, book) => {
    const position = seriesPosition(book.seriesOrder);
    return position === Number.MAX_SAFE_INTEGER
      ? highest
      : Math.max(highest, Math.floor(position));
  }, 0);
  const minimum = status === SeriesPublicationStatus.COMPLETED
    ? series.books.length
    : Math.max(series.books.length, highestPosition);

  if (total != null && (!Number.isInteger(total) || total < minimum)) {
    return {
      ok: false,
      mensaje: `El total previsto no puede ser inferior a ${minimum}`,
    };
  }

  const updated = await prisma.series.update({
    where: { id: seriesId },
    data: {
      publicationStatus: status as SeriesPublicationStatus,
      totalBooks: total,
    },
  });
  return {
    ok: true,
    mensaje: 'Estado editorial actualizado',
    saga: {
      id: updated.id,
      estadoEditorial: updated.publicationStatus,
      totalPrevisto: updated.totalBooks,
    },
  };
}

function seriesPosition(value: string | null) {
  const text = value?.trim().replace(',', '.') ?? '';
  const fraction = /^(\d+)\s*(?:\/|de)\s*(\d+)$/i.exec(text);
  const parsed = Number.parseFloat(fraction?.[1] ?? text);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
