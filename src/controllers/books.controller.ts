import type { Request, Response } from 'express';
import {
  getLibros,
  getLibrosGlobal,
  getLibrosFinalizados,
  getLibrosFinalizadosTodos,
  getLibrosFinalizadosTodosGlobal,
  getLibrosFinalizadosPage,
  anadirLibroExistente,
  actualizarPreferenciasLibro,
  iniciarLectura,
  actualizarEstado,
  actualizarValoracion,
  crearLibro,
  quitarLibroPendientes,
  editarLibro,
  actualizarProgresoLectura,
  toggleProgressReaction,
} from '../services/books.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';
import { prisma } from '../prisma.js';
import {
  hasExplicitPagination,
  parsePagination,
} from '../utils/cursor-pagination.js';

export async function handleLibros(req: Request, res: Response) {
  const data = await getLibros(requestUserName(req));
  return res.json(data);
}

export async function handleLibrosGlobal(req: Request, res: Response) {
  const data = await getLibrosGlobal(requestUserName(req));
  return res.json(data);
}

export async function handleLibrosFinalizadosTodosGlobal(
  req: Request,
  res: Response,
) {
  const data = await getLibrosFinalizadosTodosGlobal(requestUserName(req));
  return res.json(data);
}

export async function handleActualizarProgresoLectura(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};
  const data = await actualizarProgresoLectura(
    requestUserName(req),
    String(body.libro ?? ''),
    Number(body.progreso ?? 0),
    String(body.comentario ?? ''),
    body.paginaActual === undefined
      ? undefined
      : Number(body.paginaActual),
    body.paginasTotales === undefined
      ? undefined
      : Number(body.paginasTotales),
  );
  return res.json(data);
}

export async function handleToggleProgressReaction(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};
  const data = await toggleProgressReaction(
    requestUserName(req),
    String(body.libraryId ?? ''),
    String(body.reaccion ?? 'LIKE'),
  );
  return res.json(data);
}

export async function handleLibrosFinalizados(req: Request, res: Response) {
  if (hasExplicitPagination(req.query)) {
    return res.json(
      await getLibrosFinalizadosPage(
        requestUserName(req),
        parsePagination(req.query),
      ),
    );
  }
  const data = await getLibrosFinalizados(
    requestUserName(req),
  );
  return res.json(data);
}

export async function handleCrearLibro(req: Request, res: Response) {
  const data = await crearLibro({
    ...(req.body ?? {}),
    usuario: requestUserName(req),
  });
  return res.json(data);
}

export async function handleAnadirLibroExistente(req: Request, res: Response) {
  const body = req.body ?? {};
  const data = await anadirLibroExistente(
    requestUserName(req),
    String(body.libro || ''),
    String(body.prioridad || ''),
    String(body.formato || ''),
  );

  return res.json(data);
}

export async function handleActualizarPreferenciasLibro(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};
  const data = await actualizarPreferenciasLibro(
    requestUserName(req),
    String(body.libro ?? ''),
    String(body.prioridad ?? ''),
    String(body.formato ?? ''),
  );
  return res.json(data);
}

export async function handleIniciarLectura(req: Request, res: Response) {
  const data = await iniciarLectura(
    requestUserName(req),
    String(req.body?.libro || ''),
  );

  return res.json(data);
}

export async function handleActualizarValoracion(req: Request, res: Response) {
  const data = await actualizarValoracion(
    requestUserName(req),
    String(req.body?.libro || ''),
    String(req.body?.valoracion || ''),
  );

  return res.json(data);
}

export async function handleActualizarEstado(req: Request, res: Response) {
  const body = req.body ?? {};

  const data = await actualizarEstado(
    requestUserName(req),
    String(body.libro || ''),
    String(body.estado || ''),
    String(body.valoracion || ''),
    String(body.reflexion || ''),
    String(body.motivoPausa || ''),
    String(body.fechaInicio || ''),
    String(body.fechaFin || ''),
    String(body.formato || ''),
  );

  return res.json(data);
}

export async function handleQuitarLibroPendientes(req: Request, res: Response) {
  const usuario = requestUserName(req);

  const libro = String(req.body?.libro ?? '');

  const data = await quitarLibroPendientes(
    usuario,
    libro,
  );

  return res.json(data);
}

export async function handleEditarLibro(
  req: Request,
  res: Response,
) {
  const data = await editarLibro({
    ...(req.body ?? {}),
    usuario: requestUserName(req),
    bookId: req.body?.bookId ?? req.body?.id ?? '',
  });

  return res.json(data);
}

export async function handleEditarFechaInicioLectura(req: Request, res: Response) {
  const usuario = requestUserName(req);
  const libro = String(req.body?.libro ?? '').trim();
  const fechaInicio = String(req.body?.fechaInicio ?? '').trim();

  if (!libro || !fechaInicio) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan datos obligatorios.' });
  }

  const fecha = new Date(fechaInicio);
  if (isNaN(fecha.getTime())) {
    return res.status(400).json({ ok: false, mensaje: 'Fecha no válida.' });
  }

  const user = await prisma.user.findUnique({ where: { name: usuario } });
  if (!user) return res.status(401).json({ ok: false, mensaje: 'Usuaria no encontrada.' });

  const book = await prisma.book.findFirst({
    where: { title: { equals: libro.trim(), mode: 'insensitive' }, deletedAt: null },
    select: { id: true },
  });
  if (!book) return res.status(404).json({ ok: false, mensaje: 'Libro no encontrado.' });

  const library = await prisma.library.findUnique({
    where: { userId_bookId: { userId: user.id, bookId: book.id } },
    select: { status: true },
  });

  const editableStatuses = ['READING', 'REREADING', 'PAUSED'];
  if (!library || !editableStatuses.includes(library.status)) {
    return res.status(409).json({
      ok: false,
      mensaje: 'Solo se puede editar la fecha de inicio de lecturas en curso o pausadas.',
    });
  }

  await prisma.library.update({
    where: { userId_bookId: { userId: user.id, bookId: book.id } },
    data: { startedAt: fecha },
  });

  return res.json({ ok: true });
}

export async function handleActualizarPaginaLibrary(req: Request, res: Response) {
  const userName = requestUserName(req);
  const bookId = String(req.body?.bookId ?? '').trim();
  const paginaActual = Number(req.body?.paginaActual);

  if (!bookId || !Number.isInteger(paginaActual) || paginaActual < 0) {
    return res.status(400).json({ ok: false, mensaje: 'Datos incorrectos.' });
  }

  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return res.status(401).json({ ok: false });

  await prisma.library.updateMany({
    where: { userId: user.id, bookId },
    data: { currentPage: paginaActual },
  });

  return res.json({ ok: true });
}

export async function handleLibrosFinalizadosTodos(req: Request, res: Response) {
  const data = await getLibrosFinalizadosTodos(requestUserName(req));
  return res.json(data);
}

export async function handleExportBiblioteca(req: Request, res: Response) {
  const { exportBiblioteca } = await import('../services/export-biblioteca.service.js');
  const data = await exportBiblioteca(requestUserName(req));
  return res.json(data);
}

export async function handleGetLibroPorId(req: Request, res: Response) {
  const { getLibroPorId } = await import('../services/libro-por-id.service.js');
  const bookId = String(req.query.bookId || req.query.id || '').trim();
  const global = req.query.global === 'true';
  const data = await getLibroPorId(bookId, requestUserName(req), global);
  return res.json(data);
}