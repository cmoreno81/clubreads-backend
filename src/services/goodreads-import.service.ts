import {
  ImportSource,
  Priority,
  Prisma,
  ReadingStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';

import { prisma } from '../prisma.js';
import { canonicalBookTitle } from './catalog.service.js';
import { findImportedBookCover } from './book-cover.service.js';
import { findBookByIdentity, lockBookIdentity, findSimilarBooks } from './book-identity.service.js';
import { logger, logAt } from '../logging/logger.js';

const MAX_IMPORT_ROWS = 2_000;
const IMPORT_TRANSACTION_MAX_WAIT_MS = 10_000;
const IMPORT_BATCH_TIMEOUT_MS = 30_000;
const IMPORT_BATCH_SIZE = 20;

export type GoodreadsRow = {
  index: number;
  title: string;
  author: string;
  additionalAuthors: string[];
  isbn: string;
  isbn13: string;
  rating: number | null;
  pages: number | null;
  publicationYear: number | null;
  dateRead: Date | null;
  dateAdded: Date | null;
  exclusiveShelf: string;
  review: string;
  sourceRowId: string;
};

type ImportBookSnapshot = {
  id: string;
  title: string;
  isbn: string | null;
  coverUrl: string | null;
  authorId: string | null;
  author: { name: string } | null;
  library: { id: string }[];
};

type ImportAction =
  | 'PROTEGIDO'
  | 'ANADIR'
  | 'NUEVO'
  | 'REVISAR'
  | 'OMITIR';

type ImportPreviewItem = {
  index: number;
  titulo: string;
  autor: string;
  accion: ImportAction;
  mensaje: string;
  bookId?: string;
  candidatos?: ImportCandidate[];
};

export function parseImportSource(value: unknown): ImportSource {
  const source = String(value ?? '').trim().toUpperCase();
  if (source === ImportSource.GOODREADS || source === ImportSource.BOOKMORY) {
    return source as ImportSource;
  }
  throw new GoodreadsImportError(
    400,
    'INVALID_IMPORT_SOURCE',
    'La fuente debe ser GOODREADS o BOOKMORY.',
  );
}

type ImportCandidate = {
  bookId: string;
  titulo: string;
  autor: string;
  isbn: string;
  coverUrl: string;
};

type CoverTask = {
  bookId: string;
  title: string;
  author: string;
  isbn: string;
};

export function chunkImportRows<T>(rows: T[], size = IMPORT_BATCH_SIZE) {
  if (!Number.isInteger(size) || size <= 0) throw new Error('INVALID_BATCH_SIZE');
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export function parseImportResolutions(value: unknown) {
  if (value === undefined || value === null) return new Map<number, string>();
  const entries = Array.isArray(value)
    ? value.map((item) => {
        const resolution = item && typeof item === 'object'
          ? item as Record<string, unknown>
          : {};
        return [Number(resolution.index), String(resolution.bookId ?? '').trim()] as const;
      })
    : value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).map(([index, bookId]) =>
          [Number(index), String(bookId ?? '').trim()] as const
        )
      : [];
  if (!Array.isArray(value) && (!value || typeof value !== 'object')) {
    throw new GoodreadsImportError(400, 'INVALID_IMPORT_RESOLUTIONS', 'Las resoluciones de importación no son válidas.');
  }
  const resolutions = new Map<number, string>();
  for (const [index, bookId] of entries) {
    if (!Number.isInteger(index) || index < 0 || !bookId ||
      (resolutions.has(index) && resolutions.get(index) !== bookId)) {
      throw new GoodreadsImportError(400, 'INVALID_IMPORT_RESOLUTIONS', 'Cada resolución necesita un índice y un bookId válidos.');
    }
    resolutions.set(index, bookId);
  }
  return resolutions;
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/\s+/g, ' ');
}

export function importAuthorIdentity(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isAmbiguousBookmoryAuthor(value: string) {
  const author = value.trim();
  if (!author) return true;
  // Bookmory serializa varios autores con comas, pero una coma también puede
  // significar "Apellido, Nombre". Sin estructura adicional no es seguro.
  return author.includes(',') || /\bautores?\/?as?\b/i.test(author);
}

function authorTokens(value: string) {
  return importAuthorIdentity(value).split(' ').filter(Boolean).sort();
}

export function compatibleAuthorScore(imported: string, catalog: string) {
  const left = authorTokens(imported);
  const right = authorTokens(catalog);
  if (!left.length || !right.length) return 0;
  if (left.join(' ') === right.join(' ')) return 3;
  const common = left.filter((token) => right.includes(token)).length;
  return common / Math.max(left.length, right.length);
}

export function importRowIdempotencyKey(
  source: ImportSource,
  row: Pick<GoodreadsRow, 'sourceRowId' | 'title' | 'author' | 'isbn' | 'isbn13' | 'rating' | 'dateRead' | 'dateAdded' | 'review'>,
) {
  const stableRow = row.sourceRowId.trim() || JSON.stringify({
    title: normalize(row.title),
    author: normalize(row.author),
    isbn: row.isbn13 || row.isbn,
    rating: row.rating,
    dateRead: row.dateRead?.toISOString() ?? null,
    dateAdded: row.dateAdded?.toISOString() ?? null,
    review: row.review,
  });
  return createHash('sha256')
    .update(`${source}:${stableRow}`)
    .digest('hex');
}

function normalizedIsbn(value: unknown) {
  return String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalRating(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5
    ? parsed
    : null;
}

function optionalDate(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeGoodreadsReview(value: unknown) {
  return String(value ?? '')
    .replace(/(?:<|&lt;)br\s*\/?(?:>|&gt;)/gi, '\n')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, 20_000);
}

export function parseImportRows(value: unknown): GoodreadsRow[] {
  if (!Array.isArray(value)) {
    throw new GoodreadsImportError(
      400,
      'INVALID_GOODREADS_FILE',
      'El archivo de Goodreads no contiene filas válidas.',
    );
  }
  if (value.length > MAX_IMPORT_ROWS) {
    throw new GoodreadsImportError(
      400,
      'GOODREADS_FILE_TOO_LARGE',
      `La importación admite un máximo de ${MAX_IMPORT_ROWS} libros cada vez.`,
    );
  }

  const parsed = value.map((item, index) => {
    const row = item && typeof item === 'object'
      ? item as Record<string, unknown>
      : {};
    const suppliedIndex = Number(row.index);
    return {
      index: Number.isInteger(suppliedIndex) && suppliedIndex >= 0
        ? suppliedIndex
        : index,
      title: String(row.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 500),
      author: String(row.author ?? '').trim().replace(/\s+/g, ' ').slice(0, 250),
      additionalAuthors: Array.isArray(row.additionalAuthors)
        ? row.additionalAuthors
          .map(String)
          .map((author) => author.trim())
          .filter(Boolean)
          .slice(0, 20)
        : [],
      isbn: normalizedIsbn(row.isbn),
      isbn13: normalizedIsbn(row.isbn13),
      rating: optionalRating(row.rating),
      pages: positiveInteger(row.pages),
      publicationYear: positiveInteger(row.publicationYear),
      dateRead: optionalDate(row.dateRead),
      dateAdded: optionalDate(row.dateAdded),
      exclusiveShelf: normalize(String(row.exclusiveShelf ?? 'to-read')),
      review: normalizeGoodreadsReview(row.review),
      sourceRowId: String(row.sourceRowId ?? row.rowId ?? row.id ?? '').trim().slice(0, 500),
    };
  });
  if (new Set(parsed.map((row) => row.index)).size !== parsed.length) {
    throw new GoodreadsImportError(
      400,
      'INVALID_GOODREADS_ROW_INDEX',
      'La importación contiene índices de fila repetidos.',
    );
  }
  return parsed;
}

export function importTitleVariants(value: string) {
  const canonical = canonicalBookTitle(value);
  const withoutSeriesSuffix = canonical
    .replace(
      /\s*\((?=[^)]*(?:#\s*\d+|\b(?:book|libro|series|serie|universe|universo|saga|trilogy|trilogia)\b))[^)]*\)\s*$/i,
      '',
    )
    .replace(/\s+(?:#|n[ºo.]?\s*)\d+\s*$/i, '')
    .trim();
  const withoutTrailingParenthetical = canonical
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
  // Variante sin subtítulo: quita todo lo que va tras ": " o " . " (separadores de subtítulo
  // habituales en Bookmory/Goodreads, ej. "Book Lovers: Amor entre libros" → "Book Lovers",
  // "Immortal Dark. Peligroso. Irresistible." → "Immortal Dark").
  // Solo se aplica si el fragmento anterior al separador tiene al menos 4 caracteres,
  // para no mutilar títulos cortos genuinos.
  const withoutSubtitle = canonical
    .replace(/\s*:\s+.+$/, '')
    .replace(/\s+\.\s+.+$/, '')
    .trim();
  return [
    ...new Set(
      [canonical, withoutSeriesSuffix, withoutTrailingParenthetical,
       withoutSubtitle.length >= 4 ? withoutSubtitle : null]
        .filter((x): x is string => typeof x === 'string' && x.length > 0),
    ),
  ];
}

function workKeys(title: string, author: string) {
  const normalizedAuthor = importAuthorIdentity(author);
  return importTitleVariants(title).map(
    (variant) => `${variant}:${normalizedAuthor}`,
  );
}

function rowAuthors(row: GoodreadsRow) {
  return [...new Set(
    [row.author, ...row.additionalAuthors]
      .map(importAuthorIdentity)
      .filter(Boolean),
  )];
}

function rowWorkKeys(row: GoodreadsRow) {
  return rowAuthors(row).flatMap((author) =>
    importTitleVariants(row.title).map((title) => `${title}:${author}`)
  );
}

function importedStatus(shelf: string) {
  if (shelf === 'read') return ReadingStatus.FINISHED;
  if (shelf === 'currently-reading') return ReadingStatus.READING;
  return ReadingStatus.PENDING;
}

export function isRatedFinishedGoodreadsRow(
  row: Pick<GoodreadsRow, 'exclusiveShelf' | 'rating'>,
) {
  return row.exclusiveShelf === 'read' && row.rating !== null;
}

function importedFinishedAt(row: GoodreadsRow, now = new Date()) {
  if (row.exclusiveShelf !== 'read') return null;
  if (row.dateRead) return row.dateRead;
  if (
    row.dateAdded &&
    row.dateAdded.getUTCFullYear() < now.getUTCFullYear()
  ) {
    return row.dateAdded;
  }
  return new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 31, 12));
}

async function userForImport(userName: string) {
  const user = await prisma.user.findUnique({
    where: { name: userName.trim() },
  });
  if (!user) {
    throw new GoodreadsImportError(
      404,
      'USER_NOT_FOUND',
      'No se ha encontrado tu cuenta.',
    );
  }
  return user;
}

export async function buildImportPreview(
  userId: string,
  rows: GoodreadsRow[],
  source: ImportSource,
  database: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const books = await database.book.findMany({
    where: { deletedAt: null },
    include: {
      author: true,
      library: {
        where: { userId },
        select: { id: true },
      },
    },
  });
  const candidateFromBook = (book: typeof books[number]): ImportCandidate => ({
    bookId: book.id,
    titulo: book.title,
    autor: book.author?.name ?? '',
    isbn: book.isbn ?? '',
    coverUrl: book.coverUrl ?? '',
  });
  const byIsbn = new Map<string, typeof books>();
  const byWork = new Map<string, typeof books>();
  const byTitle = new Map<string, typeof books>();

  for (const book of books) {
    const isbn = normalizedIsbn(book.isbn);
    if (isbn) byIsbn.set(isbn, [...(byIsbn.get(isbn) ?? []), book]);
    for (const title of importTitleVariants(book.title)) {
      byTitle.set(title, [...(byTitle.get(title) ?? []), book]);
    }
    for (const key of workKeys(book.title, book.author?.name ?? '')) {
      byWork.set(key, [...(byWork.get(key) ?? []), book]);
    }
  }

  const seen = new Set<string>();
  const importedAuthorsByTitle = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const title of importTitleVariants(row.title)) {
      const authors = importedAuthorsByTitle.get(title) ?? new Set<string>();
      rowAuthors(row).forEach((author) => authors.add(author));
      importedAuthorsByTitle.set(title, authors);
    }
  }
  return Promise.all(rows.map(async (row): Promise<ImportPreviewItem> => {
    if (!row.title || !row.author) {
      return {
        index: row.index,
        titulo: row.title || 'Fila sin título',
        autor: row.author,
        accion: 'OMITIR',
        mensaje: 'Faltan el título o el autor.',
      };
    }

    const rowIdentities = [
      row.isbn13 ? `isbn:${row.isbn13}` : '',
      row.isbn ? `isbn:${row.isbn}` : '',
      ...rowWorkKeys(row).map((key) => `work:${key}`),
    ].filter(Boolean);
    if (rowIdentities.some((key) => seen.has(key))) {
      return {
        index: row.index,
        titulo: row.title,
        autor: row.author,
        accion: 'OMITIR',
        mensaje: 'Este libro está repetido dentro del archivo.',
      };
    }
    rowIdentities.forEach((key) => seen.add(key));

    const isbnMatches = [
      ...(row.isbn13 ? byIsbn.get(row.isbn13) ?? [] : []),
      ...(row.isbn ? byIsbn.get(row.isbn) ?? [] : []),
    ];
    const titleMatches = rowWorkKeys(row)
      .flatMap((key) => byWork.get(key) ?? []);
    const exactTitleMatches = importTitleVariants(row.title)
      .flatMap((title) => byTitle.get(title) ?? []);
    const uniqueTitleMatches = [
      ...new Map(exactTitleMatches.map((book) => [book.id, book])).values(),
    ];
    const titleHasSeveralImportedAuthors = importTitleVariants(row.title).some(
      (title) => (importedAuthorsByTitle.get(title)?.size ?? 0) > 1,
    );
    const soleTitleMatch = uniqueTitleMatches.length === 1
      ? uniqueTitleMatches[0]
      : null;
    const fallbackTitleMatches =
      soleTitleMatch &&
        !soleTitleMatch.authorId &&
        !titleHasSeveralImportedAuthors
        ? [soleTitleMatch]
        : uniqueTitleMatches.filter((book) =>
          rowAuthors(row).includes(
            importAuthorIdentity(book.author?.name ?? ''),
          )
        );
    const exactAuthorMatches = uniqueTitleMatches.filter((book) =>
      rowAuthors(row).includes(importAuthorIdentity(book.author?.name ?? ''))
    );
    const ambiguousBookmoryAuthor = source === ImportSource.BOOKMORY &&
      isAmbiguousBookmoryAuthor(row.author);
    const rowIsbn = row.isbn13 || row.isbn;
    const isbnConflicts = (book: typeof books[number]) => Boolean(
      rowIsbn && normalizedIsbn(book.isbn) && normalizedIsbn(book.isbn) !== rowIsbn,
    );
    const allReasonableTitleMatches = [...uniqueTitleMatches].sort((left, right) => {
      const leftIsbn = isbnMatches.some(({ id }) => id === left.id) ? 1 : 0;
      const rightIsbn = isbnMatches.some(({ id }) => id === right.id) ? 1 : 0;
      return rightIsbn - leftIsbn ||
        compatibleAuthorScore(row.author, right.author?.name ?? '') -
          compatibleAuthorScore(row.author, left.author?.name ?? '') ||
        left.title.localeCompare(right.title, 'es');
    });
    const safeIsbnMatch = isbnMatches.length === 1 ? isbnMatches[0] : null;
    const safeAuthorMatch = !ambiguousBookmoryAuthor && exactAuthorMatches.length === 1 &&
      !isbnConflicts(exactAuthorMatches[0])
      ? exactAuthorMatches[0]
      : null;
    const safeMatch = safeIsbnMatch ?? safeAuthorMatch;
    const conflictingTitle = uniqueTitleMatches.length > 0 && !safeMatch;
    const candidates = allReasonableTitleMatches;

    if (ambiguousBookmoryAuthor) {
      return {
        index: row.index,
        titulo: row.title,
        autor: row.author,
        accion: 'REVISAR',
        mensaje: uniqueTitleMatches.length > 0
          ? 'Bookmory contiene una autoría ambigua; elige manualmente entre las coincidencias por título.'
          : 'Bookmory contiene una autoría ambigua y no puede crear el autor automáticamente.',
        candidatos: candidates.map(candidateFromBook),
      };
    }

    if (conflictingTitle) {
      return {
        index: row.index,
        titulo: row.title,
        autor: row.author,
        accion: 'REVISAR',
        mensaje: 'El título ya existe, pero autor o ISBN no coinciden con seguridad; revísalo antes de importar.',
        candidatos: candidates.map(candidateFromBook),
      };
    }

    if (candidates.length > 1) {
      return {
        index: row.index,
        titulo: row.title,
        autor: row.author,
        accion: 'REVISAR',
        mensaje: 'Hay varias coincidencias posibles; no se importará automáticamente.',
        candidatos: candidates.map(candidateFromBook),
      };
    }
    const match = safeMatch ?? candidates[0];
    if (!match) {
      if (
        soleTitleMatch &&
        !soleTitleMatch.authorId &&
        titleHasSeveralImportedAuthors
      ) {
        return {
          index: row.index,
          titulo: row.title,
          autor: row.author,
          accion: 'REVISAR',
          mensaje:
            'El título existe sin autor y el archivo contiene varias obras homónimas; revísalo para no unir libros distintos.',
          candidatos: uniqueTitleMatches.map(candidateFromBook),
        };
      }
      // Antes de marcar como NUEVO, buscar libros similares por solapamiento de palabras.
      // Si hay candidatos con ≥ 50 % de overlap, se muestra como REVISAR para que el usuario
      // confirme si es el mismo libro o uno distinto. Esto evita duplicados cuando Bookmory/
      // Goodreads usa subtítulos o formatos de título distintos al que ya tenemos en el catálogo.
      const similares = await findSimilarBooks(database, row.title, {
        authorName: row.author ?? null,
        limit: 3,
      });
      if (similares.length > 0) {
        return {
          index: row.index,
          titulo: row.title,
          autor: row.author,
          accion: 'REVISAR' as const,
          mensaje:
            'No se encontró una coincidencia exacta, pero hay libros parecidos en el catálogo. Revisa si es el mismo antes de crear uno nuevo.',
          candidatos: similares.map((s) => ({
            bookId:   s.id,
            titulo:   s.title,
            autor:    s.authorName ?? '',
            isbn:     '',
            coverUrl: s.coverUrl ?? '',
          })),
        };
      }
      return {
        index: row.index,
        titulo: row.title,
        autor: row.author,
        accion: 'NUEVO',
        mensaje: 'Se creará y se añadirá a tu biblioteca.',
      };
    }
    if (match.library.length > 0) {
      return {
        index: row.index,
        titulo: row.title,
        autor: row.author,
        accion: 'PROTEGIDO',
        mensaje: 'Ya está en ClubReads; se conservarán tus datos.',
        bookId: match.id,
        candidatos: candidates.map(candidateFromBook),
      };
    }
    return {
      index: row.index,
      titulo: row.title,
      autor: row.author,
      accion: 'ANADIR',
      mensaje: 'Ya existe en ClubReads y se añadirá a tu biblioteca.',
      bookId: match.id,
      candidatos: candidates.map(candidateFromBook),
    };
  }));
}

function previewSummary(items: ImportPreviewItem[], excluded = 0) {
  const count = (action: ImportAction) =>
    items.filter((item) => item.accion === action).length;
  return {
    total: items.length + excluded,
    nuevos: count('NUEVO'),
    paraAnadir: count('ANADIR'),
    protegidos: count('PROTEGIDO'),
    paraRevisar: count('REVISAR'),
    omitidos: count('OMITIR') + excluded,
  };
}

export async function previewGoodreadsImport(
  userName: string,
  rawRows: unknown,
  rawSource: unknown,
) {
  const source = parseImportSource(rawSource);
  const user = await userForImport(userName);
  const rows = parseImportRows(rawRows);
  const eligibleRows = rows.filter(isRatedFinishedGoodreadsRow);
  const items = await buildImportPreview(user.id, eligibleRows, source);
  return {
    ok: true,
    source,
    resumen: previewSummary(items, rows.length - eligibleRows.length),
    libros: items,
  };
}

async function fillEmptyBookMetadata(
  tx: Prisma.TransactionClient,
  book: {
    id: string;
    authorId: string | null;
    isbn: string | null;
    totalPages: number | null;
    publicationYear: number | null;
  },
  row: GoodreadsRow,
) {
  const isbn = row.isbn13 || row.isbn;
  const data: Prisma.BookUpdateInput = {};
  if (!book.isbn && isbn) data.isbn = isbn;
  if (!book.totalPages && row.pages) data.totalPages = row.pages;
  if (!book.publicationYear && row.publicationYear) {
    data.publicationYear = row.publicationYear;
  }
  if (!book.authorId && row.author.trim()) {
    const existingAuthor = await tx.author.findFirst({
      where: {
        name: {
          equals: row.author.trim(),
          mode: 'insensitive',
        },
      },
    });
    const author = existingAuthor ?? await tx.author.create({
      data: { name: row.author.trim() },
    });
    data.author = { connect: { id: author.id } };
  }
  if (Object.keys(data).length > 0) {
    await tx.book.update({ where: { id: book.id }, data });
  }
}

async function addPersonalData(
  tx: Prisma.TransactionClient,
  userId: string,
  bookId: string,
  row: GoodreadsRow,
) {
  const status = importedStatus(row.exclusiveShelf);
  const startedAt = row.dateAdded;
  const finishedAt = importedFinishedAt(row);
  await tx.library.create({
    data: {
      userId,
      bookId,
      status,
      priority: Priority.MEDIUM,
      readingFormat: null,
      startedAt,
      finishedAt,
    },
  });

  if (row.rating !== null) {
    await tx.review.create({
      data: {
        userId,
        bookId,
        rating: row.rating,
        review: row.review || null,
      },
    });
  }
  if (status === ReadingStatus.FINISHED && finishedAt) {
    await tx.readingCompletion.create({
      data: {
        userId,
        bookId,
        startedAt,
        finishedAt,
        rating: row.rating,
        review: row.review || null,
      },
    });
  }
}

async function fillEmptyPersonalReview(
  tx: Prisma.TransactionClient,
  userId: string,
  bookId: string,
  row: GoodreadsRow,
) {
  const importedReview = row.review.trim();
  if (!importedReview || row.rating === null) return false;

  const existingReview = await tx.review.findUnique({
    where: { userId_bookId: { userId, bookId } },
    select: { id: true, review: true },
  });
  let restored = false;

  if (!existingReview) {
    await tx.review.create({
      data: {
        userId,
        bookId,
        rating: row.rating,
        review: importedReview,
      },
    });
    restored = true;
  } else if (!existingReview.review?.trim()) {
    await tx.review.update({
      where: { id: existingReview.id },
      data: { review: importedReview },
    });
    restored = true;
  }

  const completion = await tx.readingCompletion.findFirst({
    where: { userId, bookId },
    orderBy: { finishedAt: 'desc' },
    select: { id: true, review: true },
  });
  if (completion && !completion.review?.trim()) {
    await tx.readingCompletion.update({
      where: { id: completion.id },
      data: { review: importedReview },
    });
    restored = true;
  }

  return restored;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function enrichMissingCovers(tasks: CoverTask[]) {
  const uniqueTasks = [
    ...new Map(tasks.map((task) => [task.bookId, task])).values(),
  ];
  for (const task of uniqueTasks) {
    const book = await prisma.book.findUnique({
      where: { id: task.bookId },
      select: { coverUrl: true },
    });
    if (!book || book.coverUrl?.trim()) continue;

    const coverUrl = await findImportedBookCover(task);
    if (coverUrl) {
      await prisma.book.updateMany({
        where: {
          id: task.bookId,
          OR: [{ coverUrl: null }, { coverUrl: '' }],
        },
        data: { coverUrl },
      });
    }
    await wait(120);
  }
}

export async function confirmGoodreadsImport(
  userName: string,
  rawRows: unknown,
  rawResolutions?: unknown,
  rawSource?: unknown,
) {
  const source = parseImportSource(rawSource);
  const user = await userForImport(userName);
  const parsedRows = parseImportRows(rawRows);
  const rows = parsedRows.filter(isRatedFinishedGoodreadsRow);
  const resolutions = parseImportResolutions(rawResolutions);
  const validatedResolutions = new Map<number, string>();
  if (resolutions.size > 0) {
    const offered = await buildImportPreview(user.id, rows, source);
    for (const [index, bookId] of resolutions) {
      const item = offered.find((candidate) => candidate.index === index);
      if (
        item?.accion !== 'REVISAR' ||
        !item.candidatos?.some((candidate) => candidate.bookId === bookId)
      ) {
        throw new GoodreadsImportError(
          400,
          'INVALID_IMPORT_RESOLUTION',
          `La resolución de la fila ${index + 1} no pertenece a los candidatos ofrecidos.`,
        );
      }
      validatedResolutions.set(index, bookId);
    }
  }
  const result = {
    created: 0,
    added: 0,
    protectedCount: 0,
    restoredReviews: 0,
    coverTasks: [] as CoverTask[],
    reviewCount: 0,
    omittedCount: parsedRows.length - rows.length,
  };
  const batches = chunkImportRows(rows);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const context: { activeRow?: GoodreadsRow } = {};
    try {
      const batchResult = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`clubreads:${source.toLowerCase()}-import:${user.id}`}, 0)
          )::text
        `;
        const preview = await buildImportPreview(user.id, batch, source, tx);
        const rowsByIndex = new Map(batch.map((row) => [row.index, row]));
        const resolvedPreview = preview.map((item) => {
          const selectedBookId = validatedResolutions.get(item.index);
          return selectedBookId
            ? { ...item, accion: 'ANADIR' as const, bookId: selectedBookId }
            : item;
        });
        const accepted = resolvedPreview.filter((item) =>
          item.accion === 'NUEVO' || item.accion === 'ANADIR' || item.accion === 'PROTEGIDO'
        );
        const totals = {
          created: 0,
          added: 0,
          protectedCount: 0,
          restoredReviews: 0,
          coverTasks: [] as CoverTask[],
          reviewCount: resolvedPreview.filter((item) => item.accion === 'REVISAR').length,
          omittedCount: resolvedPreview.filter((item) => item.accion === 'OMITIR').length,
        };
        for (const item of accepted) {
          const row = rowsByIndex.get(item.index);
          if (!row) continue;
          context.activeRow = row;
          const idempotencyKey = importRowIdempotencyKey(source, row);
          const importedBefore = await tx.importRowReceipt.findUnique({
            where: {
              userId_source_idempotencyKey: {
                userId: user.id,
                source,
                idempotencyKey,
              },
            },
          });
          if (importedBefore) {
            totals.protectedCount += 1;
            continue;
          }
          let book = item.bookId
            ? await tx.book.findFirst({ where: { id: item.bookId, deletedAt: null } })
            : null;
          if (validatedResolutions.has(item.index) && !book) {
            throw new GoodreadsImportError(
              409,
              'IMPORT_RESOLUTION_NO_LONGER_AVAILABLE',
              `El candidato elegido para la fila ${item.index + 1} ya no está disponible.`,
            );
          }
          if (!book) {
            const identity = { title: row.title, authorName: row.author, isbn: row.isbn13 || row.isbn };
            await lockBookIdentity(tx, identity);
            book = await findBookByIdentity(tx, identity);
          }
          const existingBook = Boolean(book);
          if (!book) {
            const genre = await tx.genre.upsert({
              where: { name: 'Sin género' }, update: {}, create: { name: 'Sin género' },
            });
            const author = await tx.author.upsert({
              where: { name: row.author }, update: {}, create: { name: row.author },
            });
            book = await tx.book.create({
              data: {
                title: row.title,
                authorId: author.id,
                genreId: genre.id,
                isbn: row.isbn13 || row.isbn || null,
                totalPages: row.pages,
                publicationYear: row.publicationYear,
                standalone: true,
                createdById: user.id,
              },
            });
          }
          await tx.$queryRaw`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${`${user.id}:${book.id}:goodreads-personal`}, 0)
            )::text
          `;
          const existingLibrary = await tx.library.findUnique({
            where: { userId_bookId: { userId: user.id, bookId: book.id } },
          });
          // Un libro compartido es inmutable durante la importación: si ya
          // está en la biblioteca solo completamos datos personales vacíos.
          if (existingLibrary) {
            totals.protectedCount += 1;
            if (await fillEmptyPersonalReview(tx, user.id, book.id, row)) {
              totals.restoredReviews += 1;
            }
          } else {
            if (existingBook) totals.added += 1;
            else totals.created += 1;
            await addPersonalData(tx, user.id, book.id, row);
          }
          await tx.importRowReceipt.create({
            data: {
              userId: user.id,
              source,
              idempotencyKey,
              sourceRowId: row.sourceRowId || null,
              bookId: book.id,
            },
          });
          if (!book.coverUrl?.trim()) {
            totals.coverTasks.push({
              bookId: book.id,
              title: book.title,
              author: row.author,
              isbn: row.isbn13 || row.isbn,
            });
          }
        }
        return totals;
      }, {
        maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS,
        timeout: IMPORT_BATCH_TIMEOUT_MS,
      });
      result.created += batchResult.created;
      result.added += batchResult.added;
      result.protectedCount += batchResult.protectedCount;
      result.restoredReviews += batchResult.restoredReviews;
      result.coverTasks.push(...batchResult.coverTasks);
      result.reviewCount += batchResult.reviewCount;
      result.omittedCount += batchResult.omittedCount;
    } catch (error) {
      if (error instanceof GoodreadsImportError) throw error;
      const processed = result.created + result.added + result.protectedCount;
      const rowLabel = context.activeRow
        ? `Fila ${context.activeRow.index + 1} (${context.activeRow.title || 'sin título'})`
        : `Lote ${batchIndex + 1}`;
      const isTimeout = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028';
      logAt(logger, 'error', {
        event: 'goodreads_import_batch_failed',
        batch: batchIndex + 1,
        batchStart: batch[0]?.index,
        batchEnd: batch.at(-1)?.index,
        activeRow: context.activeRow?.index,
        err: error,
      }, 'Goodreads import batch failed');
      throw new GoodreadsImportError(
        isTimeout ? 503 : 500,
        isTimeout ? 'GOODREADS_IMPORT_BATCH_TIMEOUT' : 'GOODREADS_IMPORT_BATCH_FAILED',
        `${rowLabel} no pudo importarse. ${processed} libros ya quedaron confirmados y puedes reintentar con seguridad.`,
      );
    }
  }

  void enrichMissingCovers(result.coverTasks).catch(() => {
    // La importación ya está guardada; una portada ausente no la revierte.
  });

  return {
    ok: true,
    source,
    resumen: {
      nuevos: result.created,
      anadidos: result.added,
      protegidos: result.protectedCount,
      resenasRecuperadas: result.restoredReviews,
      paraRevisar: result.reviewCount,
      omitidos: result.omittedCount,
    },
    mensaje:
      'Importación terminada. Solo se han importado libros finalizados y valorados.',
  };
}

export class GoodreadsImportError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
