import { Priority, ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

function statusToFlutter(status: string) {
  if (status === ReadingStatus.READING) return 'LEYENDO';
  if (status === ReadingStatus.FINISHED) return 'FINALIZADO';
  if (status === ReadingStatus.ABANDONED) return 'ABANDONADO';
  if (status === ReadingStatus.REREADING) return 'RELEYENDO';

  return 'PENDIENTE';
}

function priorityToFlutter(priority: string) {
  if (priority === Priority.HIGH) return 'ALTA';
  if (priority === Priority.LOW) return 'BAJA';

  return 'MEDIA';
}


function ratingFromFlutter(value?: string | null) {
  const rating = String(value ?? '').trim();

  if (!rating) return null;

  if (rating === '⭐' || rating === '⭐️') return 1;
  if (rating === '⭐⭐' || rating === '⭐️⭐️') return 2;
  if (rating === '⭐⭐⭐' || rating === '⭐️⭐️⭐️') return 3;
  if (rating === '⭐⭐⭐⭐' || rating === '⭐️⭐️⭐️⭐️') return 4;
  if (rating === '⭐⭐⭐⭐⭐' || rating === '⭐️⭐️⭐️⭐️⭐️') return 5;

  const numeric = Number(rating);
  return Number.isNaN(numeric) ? null : numeric;
}

function statusFromFlutter(estado: string): ReadingStatus {
  if (estado === 'LEYENDO') return ReadingStatus.READING;
  if (estado === 'FINALIZADO') return ReadingStatus.FINISHED;
  if (estado === 'ABANDONADO') return ReadingStatus.ABANDONED;
  if (estado === 'RELECTURA' || estado === 'RELEYENDO') {
    return ReadingStatus.REREADING;
  }

  return ReadingStatus.PENDING;
}

export async function getLibros(usuario: string) {
  const usuarioActual = usuario.trim();

  const library = await prisma.library.findMany({
    where: {
      status: {
        not: ReadingStatus.FINISHED,
      },
    },
    include: {
      book: {
        include: {
          genre: true,
          series: true,
        },
      },
      user: true,
    },
    orderBy: [
      { book: { title: 'asc' } },
      { user: { name: 'asc' } },
    ],
  });

  return library.map((item) => ({
    usuario: item.user.name,
    libro: item.book.title,
    genero: item.book.genre.name,
    saga: item.book.series?.name ?? '',
    numSaga: item.book.seriesOrder ?? '',
    autoconclusivo: item.book.standalone ? 'Si' : 'No',
    prioridad: priorityToFlutter(item.priority),
    leyendo: statusToFlutter(item.status),
    estado: statusToFlutter(item.status),
    valoracion: '',
    yaLoTengo:
      usuarioActual !== '' &&
      item.user.name.trim().toLowerCase() === usuarioActual.toLowerCase(),
    goodreads: item.book.goodreadsUrl ?? '',
  }));
}

export async function getLibrosFinalizados() {
  const library = await prisma.library.findMany({
    where: {
      status: ReadingStatus.FINISHED,
    },
    include: {
      user: true,
      book: {
        include: {
          genre: true,
          series: true,
          reviews: true,
        },
      },
    },
    orderBy: [
      { book: { title: 'asc' } },
      { user: { name: 'asc' } },
    ],
  });

  return library.map((item) => {
    const review = item.book.reviews.find(
      (review) => review.userId === item.userId,
    );

    return {
      usuario: item.user.name,
      libro: item.book.title,
      genero: item.book.genre.name,
      saga: item.book.series?.name ?? '',
      numSaga: item.book.seriesOrder ?? '',
      autoconclusivo: item.book.standalone ? 'Si' : 'No',
      valoracion: ratingToFlutter(review?.rating),
      resena: review?.review ?? '',
      review: review?.review ?? '',
      goodreads: item.book.goodreadsUrl ?? '',
      fecha: item.finishedAt ?? '',
      mes: item.finishedAt
        ? `${String(item.finishedAt.getMonth() + 1).padStart(2, '0')}/${item.finishedAt.getFullYear()}`
        : '',
    };
  });
}

export async function anadirLibroExistente(usuario: string, libro: string) {
  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
  });

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const book = await prisma.book.findFirst({
    where: { title: libro.trim() },
  });

  if (!book) return { ok: false, mensaje: 'Libro no encontrado' };

  await prisma.library.upsert({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      bookId: book.id,
      status: ReadingStatus.PENDING,
      priority: Priority.MEDIUM,
    },
  });

  return { ok: true, mensaje: 'Libro añadido' };
}

export async function iniciarLectura(usuario: string, libro: string) {
  return actualizarEstado(usuario, libro, 'LEYENDO');
}

export async function actualizarEstado(
  usuario: string,
  libro: string,
  estado: string,
  valoracion?: string,
  reflexion?: string,
) {
  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
  });

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const book = await prisma.book.findFirst({
    where: { title: libro.trim() },
  });

  if (!book) return { ok: false, mensaje: 'Libro no encontrado' };

  const status = statusFromFlutter(estado);
  const now = new Date();

  const statusDates =
    status === ReadingStatus.READING
      ? { startedAt: now, finishedAt: null }
      : status === ReadingStatus.FINISHED
        ? { finishedAt: now }
        : status === ReadingStatus.ABANDONED
          ? { finishedAt: now }
          : {};

  await prisma.library.upsert({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },
    update: {
      status,
      ...statusDates,
    },
    create: {
      userId: user.id,
      bookId: book.id,
      status,
      priority: Priority.MEDIUM,
      ...statusDates,
    },
  });

  const rating = ratingFromFlutter(valoracion);

  if (status === ReadingStatus.FINISHED || status === ReadingStatus.ABANDONED) {
    await prisma.review.upsert({
      where: {
        userId_bookId: {
          userId: user.id,
          bookId: book.id,
        },
      },
      update: {
        rating: status === ReadingStatus.ABANDONED ? 0 : rating ?? 0,
        review: reflexion?.trim() || null,
      },
      create: {
        userId: user.id,
        bookId: book.id,
        rating: status === ReadingStatus.ABANDONED ? 0 : rating ?? 0,
        review: reflexion?.trim() || null,
      },
    });
  }

  return { ok: true };
}

export async function actualizarValoracion(
  usuario: string,
  libro: string,
  valoracion: string,
) {
  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
  });

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const book = await prisma.book.findFirst({
    where: { title: libro.trim() },
  });

  if (!book) return { ok: false, mensaje: 'Libro no encontrado' };

  const rating = ratingFromFlutter(valoracion);

  if (rating === null) {
    return { ok: false, mensaje: 'Valoración no válida' };
  }

  await prisma.review.upsert({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },
    update: { rating },
    create: {
      userId: user.id,
      bookId: book.id,
      rating,
    },
  });

  return { ok: true };
}

function buildGoodreadsSearchUrl(title: string) {
  return `https://www.goodreads.com/search?q=${encodeURIComponent(title)}`;
}

function boolFromFlutter(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase();

  return (
    value === true ||
    text === 'si' ||
    text === 'sí' ||
    text === 'true' ||
    text === '1'
  );
}

export async function crearLibro(data: any) {
  const usuario = String(data.usuario || '').trim();
  const title = String(data.libro || data.titulo || data.title || '').trim();

  if (!usuario) return { ok: false, mensaje: 'Falta la usuaria' };
  if (!title) return { ok: false, mensaje: 'Falta el título del libro' };

  const user = await prisma.user.findUnique({
    where: { name: usuario },
  });

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const genreName = String(data.genero || 'Sin género').trim();
  const seriesName = String(data.saga || '').trim();
  const seriesOrder = String(data.numSaga || '').trim();
  const standalone = boolFromFlutter(data.autoconclusivo);
  const goodreadsUrl = String(data.goodreads || data.goodreadsUrl || '').trim();

  const genre = await prisma.genre.upsert({
    where: { name: genreName },
    update: {},
    create: { name: genreName },
  });

  const series = seriesName
    ? await prisma.series.upsert({
        where: { name: seriesName },
        update: { genreId: genre.id },
        create: { name: seriesName, genreId: genre.id },
      })
    : null;

  const existing = await prisma.book.findFirst({
    where: { title },
  });

  const book = existing
    ? await prisma.book.update({
        where: { id: existing.id },
        data: {
          genreId: genre.id,
          seriesId: series?.id ?? null,
          seriesOrder: seriesOrder || existing.seriesOrder,
          standalone,
          goodreadsUrl:
            goodreadsUrl ||
            existing.goodreadsUrl ||
            buildGoodreadsSearchUrl(title),
        },
      })
    : await prisma.book.create({
        data: {
          title,
          genreId: genre.id,
          seriesId: series?.id ?? null,
          seriesOrder: seriesOrder || null,
          standalone,
          goodreadsUrl: goodreadsUrl || buildGoodreadsSearchUrl(title),
        },
      });

  await prisma.library.upsert({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },
    update: {
      priority: priorityFromFlutter(data.prioridad),
    },
    create: {
      userId: user.id,
      bookId: book.id,
      status: ReadingStatus.PENDING,
      priority: priorityFromFlutter(data.prioridad),
    },
  });

  return { ok: true, mensaje: 'Libro añadido' };
}

function priorityFromFlutter(value: unknown): Priority {
  const priority = String(value ?? '').trim().toUpperCase();

  if (priority === 'ALTA') return Priority.HIGH;
  if (priority === 'BAJA') return Priority.LOW;

  return Priority.MEDIUM;
}

function ratingToFlutter(rating?: number | null) {
  if (rating === 0) return '😞';
  if (!rating) return '';
  return '⭐'.repeat(rating);
}