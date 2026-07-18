import { ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

function top<T>(items: T[], limit = 10) {
  return items.slice(0, limit);
}

export async function getRanking(anioSolicitado = new Date().getFullYear()) {
  const anio = Number.isInteger(anioSolicitado) && anioSolicitado >= 2000
    ? anioSolicitado
    : new Date().getFullYear();
  const desde = new Date(Date.UTC(anio, 0, 1));
  const hasta = new Date(Date.UTC(anio + 1, 0, 1));

  const library = await prisma.library.findMany({
    where: {
      OR: [
        { status: ReadingStatus.PENDING },
        {
          status: ReadingStatus.ABANDONED,
          finishedAt: { gte: desde, lt: hasta },
        },
      ],
    },
    include: {
      user: true,
      book: true,
    },
  });

  const finalizaciones = await prisma.readingCompletion.findMany({
    where: {
      isReread: false,
      finishedAt: { gte: desde, lt: hasta },
    },
    include: {
      book: true,
      user: true,
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
    if (item.status === ReadingStatus.PENDING) {
      deseados.set(
        item.book.title,
        (deseados.get(item.book.title) ?? 0) + 1,
      );
    }
    if (item.status === ReadingStatus.ABANDONED) {
      abandonados.set(
        item.book.title,
        (abandonados.get(item.book.title) ?? 0) + 1,
      );
    }
  }

  for (const item of finalizaciones) {
    leidos.set(item.book.title, (leidos.get(item.book.title) ?? 0) + 1);

    const lectoraActual = lectoras.get(item.user.name);
    lectoras.set(item.user.name, {
      total: (lectoraActual?.total ?? 0) + 1,
      avatarUrl: item.user.avatarUrl ?? '',
    });
  }


  const valoraciones = new Map<
    string,
    {
      suma: number;
      total: number;
    }
  >();

  for (const item of finalizaciones) {
    if (item.rating === null || item.rating <= 0) continue;
    const current = valoraciones.get(item.book.title) ?? {
      suma: 0,
      total: 0,
    };

    current.suma += item.rating;
    current.total += 1;

    valoraciones.set(item.book.title, current);
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
    anio,
    masDeseados,
    masLeidos,
    mejorValorados,
    masAbandonados,
    topLectoras,
  };
}
