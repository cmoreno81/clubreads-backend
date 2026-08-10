import type { Request, Response } from 'express';
import {
  getLibros,
  getLibrosFinalizados,
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
  const data = await getLibros(
    requestUserName(req),
  );
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
  console.log('[crearLibro] body:', JSON.stringify(req.body));
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
