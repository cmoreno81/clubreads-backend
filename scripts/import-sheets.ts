import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { Priority, ReadingStatus } from '@prisma/client';
import { prisma } from '../src/prisma.js';

const DATA_DIR = fs.existsSync(path.join(process.cwd(), 'data'))
  ? path.join(process.cwd(), 'data')
  : path.join(process.cwd(), 'ClubLecturaBackend', 'data');

type CsvRow = Record<string, string>;

function readCsv(fileName: string): CsvRow[] {
  const filePath = path.join(DATA_DIR, fileName);
  const content = fs.readFileSync(filePath, 'utf8');

  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeTitle(value: string): string {
  return clean(value).toLowerCase();
}

function mapStatus(value: unknown): ReadingStatus {
  const status = clean(value).toUpperCase();

  if (status === 'LEYENDO') return ReadingStatus.READING;
  if (status === 'FINALIZADO') return ReadingStatus.FINISHED;
  if (status === 'ABANDONADO') return ReadingStatus.ABANDONED;
  if (status === 'RELEYENDO') return ReadingStatus.REREADING;

  return ReadingStatus.PENDING;
}

function mapPriority(value: unknown): Priority {
  const priority = clean(value).toUpperCase();

  if (priority === 'ALTA' || priority === 'HIGH') return Priority.HIGH;
  if (priority === 'BAJA' || priority === 'LOW') return Priority.LOW;

  return Priority.MEDIUM;
}

function ratingToNumber(value: unknown): number | null {
  const rating = clean(value);

  if (rating === '⭐️' || rating === '⭐') return 1;
  if (rating === '⭐️⭐️' || rating === '⭐⭐') return 2;
  if (rating === '⭐️⭐️⭐️' || rating === '⭐⭐⭐') return 3;
  if (rating === '⭐️⭐️⭐️⭐️' || rating === '⭐⭐⭐⭐') return 4;
  if (rating === '⭐️⭐️⭐️⭐️⭐️' || rating === '⭐⭐⭐⭐⭐') return 5;

  return null;
}

function boolFromSheet(value: unknown): boolean {
  const v = clean(value).toLowerCase();

  return (
    v === 'true' ||
    v === 'sí' ||
    v === 'si' ||
    v === '1' ||
    v === 'x' ||
    v === 'yes'
  );
}

function parseDateOrNull(value: unknown): Date | null {
  const dateText = clean(value);

  if (!dateText) return null;

  const date = new Date(dateText);

  return Number.isNaN(date.getTime()) ? null : date;
}

async function getOrCreateGenre(name: string) {
  const genreName = clean(name) || 'Sin género';

  return prisma.genre.upsert({
    where: { name: genreName },
    update: {},
    create: { name: genreName },
  });
}

async function getOrCreateSeries(name: string, genreId?: string) {
  const seriesName = clean(name);

  if (!seriesName) return null;

  return prisma.series.upsert({
    where: { name: seriesName },
    update: genreId ? { genreId } : {},
    create: {
      name: seriesName,
      ...(genreId ? { genreId } : {}),
    },
  });
}

async function getOrCreateBook(row: CsvRow) {
  const title = clean(row['Nombre del libro']);
  const genreName = clean(row['Género']) || clean(row['Género ']);
  const seriesName = clean(row['Saga']);
  const seriesOrderRaw = clean(row['NºSaga']);
  const standaloneRaw = clean(row['Autoconclusivo']);

  if (!title) return null;

  const genre = await getOrCreateGenre(genreName);
  const series = await getOrCreateSeries(seriesName, genre.id);
 const goodreadsUrl =
  clean(row['goodreads']) ||
  clean(row['Goodreads']) ||
  clean(row['GoodreadsUrl']) ||
  clean(row['Goodreads URL']) ||
  clean(row['goodreadsUrl']);

  const existing = await prisma.book.findFirst({
    where: {
      title,
    },
  });

 if (existing) {
  return prisma.book.update({
    where: { id: existing.id },
    data: {
      goodreadsUrl: goodreadsUrl || existing.goodreadsUrl,
      seriesOrder: seriesOrderRaw || existing.seriesOrder,
    },
  });
}

  return prisma.book.create({
    data: {
      title,
      genreId: genre.id,
      seriesId: series?.id ?? null,
      seriesOrder: seriesOrderRaw || null,
      standalone: standaloneRaw ? boolFromSheet(standaloneRaw) : !series,
      goodreadsUrl: goodreadsUrl || null,
    },
  });
}

async function importUsers() {
  const rows = readCsv('config.csv');

  let count = 0;

  for (const row of rows) {
    const name = clean(row['Usuario']);
    const email = clean(row['Email']);

    if (!name || !email) continue;

    await prisma.user.upsert({
      where: { email },
      update: {
        name,
      },
      create: {
        name,
        email,
      },
    });

    count++;
  }

  console.log(`Usuarios importados: ${count}`);
}

async function importActiveBooks() {
  const rows = readCsv('libros.csv');

  let count = 0;

  for (const row of rows) {
    const userName = clean(row['Usuario']);
    const title = clean(row['Nombre del libro']);

    if (!userName || !title) continue;

    const user = await prisma.user.findUnique({
      where: { name: userName },
    });

    if (!user) {
      console.warn(`Usuaria no encontrada: ${userName}`);
      continue;
    }

    const book = await getOrCreateBook(row);

    if (!book) continue;

    await prisma.library.upsert({
      where: {
        userId_bookId: {
          userId: user.id,
          bookId: book.id,
        },
      },
      update: {
        status: mapStatus(row['Leyendo']),
        priority: mapPriority(row['Prioridad']),
      },
      create: {
        userId: user.id,
        bookId: book.id,
        status: mapStatus(row['Leyendo']),
        priority: mapPriority(row['Prioridad']),
      },
    });

    count++;
  }

  console.log(`Libros activos/biblioteca importados: ${count}`);
}

async function importFinishedBooks() {
  const rows = readCsv('libros-finalizados.csv');

  let count = 0;
  let reviews = 0;

  for (const row of rows) {
    const userName = clean(row['Usuario']);
    const title = clean(row['Nombre del libro']);

    if (!userName || !title) continue;

    const user = await prisma.user.findUnique({
      where: { name: userName },
    });

    if (!user) {
      console.warn(`Usuaria no encontrada: ${userName}`);
      continue;
    }

    const book = await getOrCreateBook(row);

    if (!book) continue;

    const finishedAt = parseDateOrNull(row['Fecha']);
    const rating = ratingToNumber(row['Valoración']);
    const reviewText = clean(row['Reseña']);

    await prisma.library.upsert({
      where: {
        userId_bookId: {
          userId: user.id,
          bookId: book.id,
        },
      },
      update: {
        status: ReadingStatus.FINISHED,
        finishedAt,
      },
      create: {
        userId: user.id,
        bookId: book.id,
        status: ReadingStatus.FINISHED,
        priority: Priority.MEDIUM,
        finishedAt,
      },
    });

    if (rating !== null || reviewText) {
      await prisma.review.upsert({
        where: {
          userId_bookId: {
            userId: user.id,
            bookId: book.id,
          },
        },
        update: {
          rating: rating ?? 0,
          review: reviewText || null,
        },
        create: {
          userId: user.id,
          bookId: book.id,
          rating: rating ?? 0,
          review: reviewText || null,
        },
      });

      reviews++;
    }

    count++;
  }

  console.log(`Libros finalizados importados: ${count}`);
  console.log(`Reviews importadas: ${reviews}`);
}

async function findBookByTitle(title: string) {
  const cleanTitle = clean(title);

  if (!cleanTitle) return null;

  return prisma.book.findFirst({
    where: {
      title: cleanTitle,
    },
  });
}

async function importClubvisionHistory() {
  const rows = readCsv('historial-clubvision.csv');

  let count = 0;

  for (const row of rows) {
    const edition = normalizeEdition(clean(row['Mes']));
    const winnerTitle = clean(row['Ganadora']);
    const points = Number(clean(row['Puntos']) || 0);
    const secondTitle = clean(row['2º']);
    const thirdTitle = clean(row['3º']);

    if (!edition || !winnerTitle) continue;

    const winnerBook = await findBookByTitle(winnerTitle);

    await prisma.clubvisionResult.upsert({
      where: {
        edition,
      },
      update: {
        winnerBookId: winnerBook?.id ?? null,
        winnerTitle,
        points,
        secondTitle: secondTitle || null,
        thirdTitle: thirdTitle || null,
      },
      create: {
        edition,
        winnerBookId: winnerBook?.id ?? null,
        winnerTitle,
        points,
        secondTitle: secondTitle || null,
        thirdTitle: thirdTitle || null,
      },
    });

    count++;
  }

  console.log(`Historial Clubvisión importado: ${count}`);
}

function normalizeEdition(value: string): string {
  const raw = clean(value);

  if (/^\d{4}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{1,2})\/(\d{4})$/);

  if (match) {
    const [, rawMonth, year] = match;
    if (!rawMonth || !year) return raw;

    const month = rawMonth.padStart(2, '0');

    return `${year}-${month}`;
  }

  return raw;
}

async function getOrCreateCurrentClubvision() {
  const edition = getCurrentEdition();

  const existing = await prisma.clubvision.findUnique({
    where: {
      edition,
    },
  });

  if (existing) return existing;

  return prisma.clubvision.create({
    data: {
      edition,
      status: 'VOTACION',
      title: '🎤 Clubvisión abierta',
      message: '🗳️ Ya puedes votar',
      openedAt: new Date(),
    },
  });
}

function getCurrentEdition() {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function ensureClubvisionCandidates(clubvisionId: string) {
  const candidates = await prisma.library.groupBy({
    by: ['bookId'],
    _count: {
      userId: true,
    },
    having: {
      userId: {
        _count: {
          gte: 2,
        },
      },
    },
  });

  let count = 0;

  for (const item of candidates) {
    await prisma.clubvisionCandidate.upsert({
      where: {
        clubvisionId_bookId: {
          clubvisionId,
          bookId: item.bookId,
        },
      },
      update: {},
      create: {
        clubvisionId,
        bookId: item.bookId,
      },
    });

    count++;
  }

  console.log(`Candidatas Clubvisión generadas: ${count}`);
}

async function importClubvisionVotes() {
  const rows = readCsv('votos-clubvision.csv');

  const clubvision = await getOrCreateCurrentClubvision();

  await ensureClubvisionCandidates(clubvision.id);

  const pointsByColumn = [
    { column: '12', points: 12, position: 1 },
    { column: '10', points: 10, position: 2 },
    { column: '8', points: 8, position: 3 },
    { column: '7', points: 7, position: 4 },
    { column: '6', points: 6, position: 5 },
  ];

  let count = 0;

  for (const row of rows) {
    const userName = clean(row['Usuario']);

    if (!userName) continue;

    const user = await prisma.user.findUnique({
      where: {
        name: userName,
      },
    });

    if (!user) {
      console.warn(`Usuaria no encontrada en votos: ${userName}`);
      continue;
    }

    for (const item of pointsByColumn) {
      const title = clean(row[item.column]);

      if (!title) continue;

      const book = await findBookByTitle(title);

      if (!book) {
        console.warn(`Libro no encontrado en voto: ${title}`);
        continue;
      }

      const candidate = await prisma.clubvisionCandidate.upsert({
        where: {
          clubvisionId_bookId: {
            clubvisionId: clubvision.id,
            bookId: book.id,
          },
        },
        update: {},
        create: {
          clubvisionId: clubvision.id,
          bookId: book.id,
          order: item.position,
        },
      });

      await prisma.clubvisionVote.upsert({
        where: {
          clubvisionId_userId_position: {
            clubvisionId: clubvision.id,
            userId: user.id,
            position: item.position,
          },
        },
        update: {
          candidateId: candidate.id,
          points: item.points,
        },
        create: {
          clubvisionId: clubvision.id,
          userId: user.id,
          candidateId: candidate.id,
          position: item.position,
          points: item.points,
        },
      });

      count++;
    }
  }

  console.log(`Votos Clubvisión importados: ${count}`);
}

async function main() {
  console.log('Importando CSV...');

  await importUsers();
  await importActiveBooks();
  await importFinishedBooks();
  await importClubvisionHistory();
  await importClubvisionVotes();
  await importReadingComments();

  console.log('Importación completada');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

  function getChapterOrder(title: string) {
  const cleanTitle = clean(title);

  if (cleanTitle === 'Prólogo') return 0;
  if (cleanTitle === 'Epílogo') return 9998;
  if (cleanTitle.includes('Reflexión')) return 9999;

  const match = cleanTitle.match(/Capítulo\s+(\d+)/i);
  return match ? Number(match[1]) : 5000;
}

function parseSheetDate(value: unknown): Date {
  const raw = clean(value);

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);

  if (match) {
    const [, d, m, y, hh, mm, ss] = match;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss),
    );
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function getOrCreateReadingForComment(bookTitle: string, chapterTitle: string) {
  const book = await prisma.book.findFirst({
    where: { title: bookTitle },
  });

  if (!book) return null;

  const chapterOrder = getChapterOrder(chapterTitle);
  const chapterNumber = chapterOrder > 0 && chapterOrder < 9998 ? chapterOrder : 0;

  let reading = await prisma.reading.findFirst({
    where: {
      bookId: book.id,
      status: 'ACTIVE',
    },
  });

  if (!reading) {
    reading = await prisma.reading.create({
      data: {
        bookId: book.id,
        type: 'CLUBVISION',
        status: 'ACTIVE',
        chapters: chapterNumber,
        hasPrologue: chapterTitle === 'Prólogo',
        hasEpilogue: chapterTitle === 'Epílogo',
      },
    });
  } else if (chapterNumber > reading.chapters) {
    reading = await prisma.reading.update({
      where: { id: reading.id },
      data: {
        chapters: chapterNumber,
      },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: {
      readingId: reading.id,
      title: chapterTitle,
    },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        readingId: reading.id,
        title: chapterTitle,
        order: chapterOrder,
      },
    });
  }

  return conversation;
}

async function importReadingComments() {
  const rows = readCsv('comentarios-lecturas.csv');

  let count = 0;

  for (const row of rows) {
    const oldId = clean(row['ID']);
    const bookTitle = clean(row['Libro']);
    const chapterTitle = clean(row['Capítulo']);
    const userName = clean(row['Usuario']);
    const text = clean(row['Comentario']);

    if (!oldId || !bookTitle || !chapterTitle || !userName || !text) continue;

    const user = await prisma.user.findUnique({
      where: { name: userName },
    });

    if (!user) {
      console.warn(`Usuaria no encontrada en comentario: ${userName}`);
      continue;
    }

    const conversation = await getOrCreateReadingForComment(bookTitle, chapterTitle);

    if (!conversation) {
      console.warn(`Libro no encontrado en comentario: ${bookTitle}`);
      continue;
    }

    await prisma.comment.upsert({
      where: { id: oldId },
      update: {
        text,
        edited: clean(row['Editado']).toUpperCase() === 'TRUE',
        deletedAt:
          clean(row['Eliminado']).toUpperCase() === 'TRUE'
            ? new Date()
            : null,
      },
      create: {
        id: oldId,
        conversationId: conversation.id,
        userId: user.id,
        text,
        edited: clean(row['Editado']).toUpperCase() === 'TRUE',
        deletedAt:
          clean(row['Eliminado']).toUpperCase() === 'TRUE'
            ? new Date()
            : null,
        createdAt: parseSheetDate(row['Fecha']),
      },
    });

    count++;
  }

  console.log(`Comentarios de lecturas importados: ${count}`);
}
