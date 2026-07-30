import {
  Priority,
  Prisma,
  ReadingStatus,
} from '@prisma/client';

import { prisma } from '../prisma.js';
import { canonicalBookTitle } from './catalog.service.js';
import { findImportedBookCover } from './book-cover.service.js';

const MAX_IMPORT_ROWS = 2_000;

type GoodreadsRow = {
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
};

type CoverTask = {
  bookId: string;
  title: string;
  author: string;
  isbn: string;
};

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

function parseRows(value: unknown): GoodreadsRow[] {
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

  return value.map((item, index) => {
    const row = item && typeof item === 'object'
      ? item as Record<string, unknown>
      : {};
    return {
      index,
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
      review: String(row.review ?? '').trim().slice(0, 20_000),
    };
  });
}

function identity(row: GoodreadsRow) {
  return `${canonicalBookTitle(row.title)}:${normalize(row.author)}`;
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
  return [...new Set([canonical, withoutSeriesSuffix].filter(Boolean))];
}

function workKeys(title: string, author: string) {
  const normalizedAuthor = importAuthorIdentity(author);
  return importTitleVariants(title).map(
    (variant) => `${variant}:${normalizedAuthor}`,
  );
}

function importedStatus(shelf: string) {
  if (shelf === 'read') return ReadingStatus.FINISHED;
  if (shelf === 'currently-reading') return ReadingStatus.READING;
  return ReadingStatus.PENDING;
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

async function buildPreview(userId: string, rows: GoodreadsRow[]) {
  const books = await prisma.book.findMany({
    where: { deletedAt: null },
    include: {
      author: true,
      library: {
        where: { userId },
        select: { id: true },
      },
    },
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
  return rows.map<ImportPreviewItem>((row) => {
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
      `work:${identity(row)}`,
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
    const titleMatches = workKeys(row.title, row.author)
      .flatMap((key) => byWork.get(key) ?? []);
    const exactTitleMatches = importTitleVariants(row.title)
      .flatMap((title) => byTitle.get(title) ?? []);
    const uniqueTitleMatches = [
      ...new Map(exactTitleMatches.map((book) => [book.id, book])).values(),
    ];
    const fallbackTitleMatches = uniqueTitleMatches.length === 1
      ? uniqueTitleMatches
      : uniqueTitleMatches.filter(
          (book) =>
            importAuthorIdentity(book.author?.name ?? '') ===
            importAuthorIdentity(row.author),
        );
    const candidates = [
      ...new Map(
        (
          isbnMatches.length > 0
            ? isbnMatches
            : titleMatches.length > 0
              ? titleMatches
              : fallbackTitleMatches
        )
          .map((book) => [book.id, book]),
      ).values(),
    ];

    if (candidates.length > 1) {
      return {
        index: row.index,
        titulo: row.title,
        autor: row.author,
        accion: 'REVISAR',
        mensaje: 'Hay varias coincidencias posibles; no se importará automáticamente.',
      };
    }
    const match = candidates[0];
    if (!match) {
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
      };
    }
    return {
      index: row.index,
      titulo: row.title,
      autor: row.author,
      accion: 'ANADIR',
      mensaje: 'Ya existe en ClubReads y se añadirá a tu biblioteca.',
      bookId: match.id,
    };
  });
}

function previewSummary(items: ImportPreviewItem[]) {
  const count = (action: ImportAction) =>
    items.filter((item) => item.accion === action).length;
  return {
    total: items.length,
    nuevos: count('NUEVO'),
    paraAnadir: count('ANADIR'),
    protegidos: count('PROTEGIDO'),
    paraRevisar: count('REVISAR'),
    omitidos: count('OMITIR'),
  };
}

export async function previewGoodreadsImport(
  userName: string,
  rawRows: unknown,
) {
  const user = await userForImport(userName);
  const rows = parseRows(rawRows);
  const items = await buildPreview(user.id, rows);
  return {
    ok: true,
    resumen: previewSummary(items),
    libros: items,
  };
}

async function fillEmptyBookMetadata(
  tx: Prisma.TransactionClient,
  book: {
    id: string;
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
  const finishedAt = importedFinishedAt(row);
  await tx.library.create({
    data: {
      userId,
      bookId,
      status,
      priority: Priority.MEDIUM,
      readingFormat: null,
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
        finishedAt,
        rating: row.rating,
        review: row.review || null,
      },
    });
  }
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
) {
  const user = await userForImport(userName);
  const rows = parseRows(rawRows);
  const preview = await buildPreview(user.id, rows);
  const accepted = preview.filter((item) =>
    item.accion === 'NUEVO' || item.accion === 'ANADIR' ||
    item.accion === 'PROTEGIDO'
  );

  const result = await prisma.$transaction(async (tx) => {
    let created = 0;
    let added = 0;
    let protectedCount = 0;
    const coverTasks: CoverTask[] = [];

    for (const item of accepted) {
      const row = rows[item.index]!;
      let book = item.bookId
        ? await tx.book.findUnique({ where: { id: item.bookId } })
        : null;

      if (book) {
        await fillEmptyBookMetadata(tx, book, row);
      }
      if (item.accion === 'PROTEGIDO') {
        protectedCount += 1;
        if (book && !book.coverUrl?.trim()) {
          coverTasks.push({
            bookId: book.id,
            title: book.title,
            author: row.author,
            isbn: row.isbn13 || row.isbn,
          });
        }
        continue;
      }
      if (!book) {
        const genre = await tx.genre.upsert({
          where: { name: 'Sin género' },
          update: {},
          create: { name: 'Sin género' },
        });
        const author = await tx.author.upsert({
          where: { name: row.author },
          update: {},
          create: { name: row.author },
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
        created += 1;
      } else {
        added += 1;
      }
      if (!book.coverUrl?.trim()) {
        coverTasks.push({
          bookId: book.id,
          title: book.title,
          author: row.author,
          isbn: row.isbn13 || row.isbn,
        });
      }
      await addPersonalData(tx, user.id, book.id, row);
    }
    return { created, added, protectedCount, coverTasks };
  });

  void enrichMissingCovers(result.coverTasks).catch(() => {
    // La importación ya está guardada; una portada ausente no la revierte.
  });

  return {
    ok: true,
    resumen: {
      nuevos: result.created,
      anadidos: result.added,
      protegidos: result.protectedCount,
      paraRevisar: preview.filter((item) => item.accion === 'REVISAR').length,
      omitidos: preview.filter((item) => item.accion === 'OMITIR').length,
    },
    mensaje:
      'Importación terminada. Las portadas pendientes se completarán automáticamente.',
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
