import { ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

function top<T>(items: T[], limit = 10) {
  return items.slice(0, limit);
}

export async function getRanking() {
  const library = await prisma.library.findMany({
    include: {
      user: true,
      book: true,
    },
  });

  const reviews = await prisma.review.findMany({
    where: {
      rating: { gt: 0 },
      deletedAt: null,
    },
    include: {
      book: true,
    },
  });

  const reviewsAbandonados = await prisma.review.findMany({
    where: {
      rating: 0,
      deletedAt: null,
    },
    include: {
      book: true,
    },
  });

  const deseados = new Map<string, number>();
  const leidos = new Map<string, number>();
  const abandonados = new Map<string, number>();
  const lectoras = new Map<
    string,
    {
      total: number;
      avatarUrl: string;
    }
  >();
  for (const item of library) {
    if (item.status !== ReadingStatus.FINISHED) {
      deseados.set(item.book.title, (deseados.get(item.book.title) ?? 0) + 1);
    }

    if (item.status === ReadingStatus.FINISHED) {
      leidos.set(
        item.book.title,
        (leidos.get(item.book.title) ?? 0) + 1,
      );

      const lectoraActual = lectoras.get(item.user.name);

      lectoras.set(item.user.name, {
        total: (lectoraActual?.total ?? 0) + 1,
        avatarUrl: item.user.avatarUrl ?? '',
      });
    }

    if (item.status === ReadingStatus.ABANDONED) {
      abandonados.set(
        item.book.title,
        (abandonados.get(item.book.title) ?? 0) + 1,
      );
    }
  }

  for (const review of reviewsAbandonados) {
    abandonados.set(
      review.book.title,
      (abandonados.get(review.book.title) ?? 0) + 1,
    );
  }

  const valoraciones = new Map<
    string,
    {
      suma: number;
      total: number;
    }
  >();

  for (const review of reviews) {
    const current = valoraciones.get(review.book.title) ?? {
      suma: 0,
      total: 0,
    };

    current.suma += review.rating;
    current.total += 1;

    valoraciones.set(review.book.title, current);
  }

  const masDeseados = top(
    Array.from(deseados.entries())
      .map(([libro, total]) => ({ libro, total }))
      .sort((a, b) => b.total - a.total),
  );

  const masLeidos = top(
    Array.from(leidos.entries())
      .map(([libro, total]) => ({ libro, total }))
      .sort((a, b) => b.total - a.total),
  );

  const masAbandonados = top(
    Array.from(abandonados.entries())
      .map(([libro, total]) => ({ libro, total }))
      .sort((a, b) => b.total - a.total),
  );

const topLectoras = top(
  Array.from(lectoras.entries())
    .map(([usuario, datos]) => ({
      usuario,
      total: datos.total,
      avatarUrl: datos.avatarUrl,
    }))
    .sort((a, b) => b.total - a.total),
);

  const mejorValorados = top(
    Array.from(valoraciones.entries())
      .map(([libro, data]) => ({
        libro,
        media: Number((data.suma / data.total).toFixed(2)),
        votos: data.total,
      }))
      .filter((item) => item.votos >= 2)
      .sort((a, b) => b.media - a.media || b.votos - a.votos),
  );

  return {
    masDeseados,
    masLeidos,
    mejorValorados,
    masAbandonados,
    topLectoras,
  };
}