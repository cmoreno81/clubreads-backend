import type { Request, Response } from 'express';

import { getGeneralDashboard } from '../services/general-dashboard.service.js';

export async function handleGeneralDashboard(
  req: Request,
  res: Response,
) {
  const data = await getGeneralDashboard(req.auth!.userId);
  if (!data) {
    return res.status(404).json({
      ok: false,
      error: 'USER_NOT_FOUND',
      mensaje: 'Cuenta no encontrada',
    });
  }
  return res.json(data);
}

import { prisma } from '../prisma.js';
import { numeroSaga } from '../services/perfil.service.js';

export async function handleLibrosPorAutor(req: Request, res: Response) {
  const autorId = req.query['autorId']?.toString();
  if (!autorId) {
    return res.status(400).json({ ok: false, mensaje: 'autorId requerido' });
  }

  const author = await prisma.author.findUnique({
    where: { id: autorId },
    include: {
      books: {
        where: { deletedAt: null },
        include: { genre: true, series: { select: { id: true, name: true } } },
        orderBy: [{ seriesId: 'asc' }, { title: 'asc' }],
      },
    },
  });

  if (!author) {
    return res.status(404).json({ ok: false, mensaje: 'Autor no encontrado' });
  }

  // seriesOrder admite formatos como "3", "3.5" o "3/5" (el "/5" indica el
  // total de tomos previstos, usado en Sagas) — ordenar por ese texto tal
  // cual ponía "3.5" antes que "3/5" (el punto pesa menos que la barra),
  // así que un tomo intermedio como "3.5" se colaba antes del tomo 3. Se
  // reutiliza el mismo parseo numérico que ya usa la pantalla de Sagas.
  const librosOrdenados = [...author.books].sort((a, b) => {
    if (a.seriesId !== b.seriesId) return (a.seriesId ?? '').localeCompare(b.seriesId ?? '');
    const diff = numeroSaga(a.seriesOrder) - numeroSaga(b.seriesOrder);
    return diff !== 0 ? diff : a.title.localeCompare(b.title);
  });

  return res.json({
    id: author.id,
    nombre: author.name,
    photoUrl: author.photoUrl ?? '',
    biografia: author.biography ?? '',
    libros: librosOrdenados.map((book) => ({
      id: book.id,
      titulo: book.title,
      coverUrl: book.coverUrl ?? '',
      genero: book.genre?.name ?? '',
      sagaId: book.seriesId ?? null,
      sagaNombre: book.series?.name ?? null,
      sagaOrden: book.seriesOrder ?? null,
    })),
  });
}