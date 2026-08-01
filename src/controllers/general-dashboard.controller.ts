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
        include: { genre: true },
        orderBy: { title: 'asc' },
      },
    },
  });

  if (!author) {
    return res.status(404).json({ ok: false, mensaje: 'Autor no encontrado' });
  }

  return res.json({
    id: author.id,
    nombre: author.name,
    photoUrl: author.photoUrl ?? '',
    biografia: author.biography ?? '',
    libros: author.books.map((book) => ({
      id: book.id,
      titulo: book.title,
      coverUrl: book.coverUrl ?? '',
      genero: book.genre?.name ?? '',
    })),
  });
}