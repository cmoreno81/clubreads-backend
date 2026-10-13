import { FriendshipStatus, ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { contarReaccionesProgreso } from '../utils/reacciones.utils.js';

export type PrivacidadAmistades = {
  leyendo: boolean;
  biblioteca: boolean;
  resenas: boolean;
};

const DIAS_ACTIVIDAD = 30;
const MAX_ACTIVIDAD = 30;

/// Personas bloqueadas en cualquier sentido (no se ven entre sí aunque
/// hubiera una amistad vieja).
async function bloqueadasConmigo(userId: string) {
  const filas = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(filas.map((f) => (f.blockerId === userId ? f.blockedId : f.blockerId)));
}

const SELECCION_AMISTAD = {
  id: true,
  name: true,
  avatarUrl: true,
  bio: true,
  readerPersonality: true,
  friendsSeeReading: true,
  friendsSeeLibrary: true,
  friendsSeeReviews: true,
} as const;

/// Las amistades aceptadas de una persona, con lo que cada una comparte.
export async function amistadesQueComparten(userId: string) {
  const [filas, bloqueadas] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: SELECCION_AMISTAD },
        addressee: { select: SELECCION_AMISTAD },
      },
    }),
    bloqueadasConmigo(userId),
  ]);
  return filas
    .map((f) => (f.requesterId === userId ? f.addressee : f.requester))
    .filter((p) => !bloqueadas.has(p.id));
}

export async function guardarPrivacidadAmistades(userId: string, datos: PrivacidadAmistades) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      friendsSeeReading: datos.leyendo,
      friendsSeeLibrary: datos.biblioteca,
      friendsSeeReviews: datos.resenas,
    },
  });
  return { ok: true, privacidad: datos };
}

export async function getPrivacidadAmistades(userId: string): Promise<PrivacidadAmistades> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { friendsSeeReading: true, friendsSeeLibrary: true, friendsSeeReviews: true },
  });
  return {
    leyendo: u?.friendsSeeReading ?? true,
    biblioteca: u?.friendsSeeLibrary ?? true,
    resenas: u?.friendsSeeReviews ?? true,
  };
}

/// Ids de las amistades que dejan ver lo que leen (para reaccionar a su progreso).
export async function idsAmistadesQueMuestranLectura(userId: string) {
  const amistades = await amistadesQueComparten(userId);
  return amistades.filter((a) => a.friendsSeeReading).map((a) => a.id);
}

type FilaLecturaLibrary = {
  id: string;
  status: ReadingStatus;
  lastProgress: number | null;
  currentPage: number | null;
  personalTotalPages: number | null;
  progressNote: string | null;
  progressUpdatedAt: Date | null;
  startedAt: Date | null;
  book: { id: string; title: string; coverUrl: string | null; totalPages: number | null; author: { name: string } | null };
};

async function reaccionesDe(ids: string[], yo: string) {
  if (ids.length === 0) return new Map<string, { reacciones: Record<string, number>; miReaccion: string | null }>();
  const filas = await prisma.progressReaction.findMany({
    where: { libraryId: { in: ids } },
    select: { libraryId: true, userId: true, reaction: true },
  });
  const mapa = new Map<string, { reacciones: Record<string, number>; miReaccion: string | null }>();
  for (const id of ids) {
    const deEste = filas.filter((f) => f.libraryId === id);
    mapa.set(id, {
      reacciones: contarReaccionesProgreso(deEste),
      miReaccion: deEste.find((f) => f.userId === yo)?.reaction ?? null,
    });
  }
  return mapa;
}

function itemLectura(
  fila: FilaLecturaLibrary,
  reacciones: Map<string, { reacciones: Record<string, number>; miReaccion: string | null }>,
) {
  return {
    libraryId: fila.id,
    bookId: fila.book.id,
    titulo: fila.book.title,
    autor: fila.book.author?.name ?? '',
    coverUrl: fila.book.coverUrl ?? '',
    estado: fila.status === ReadingStatus.REREADING ? 'RELECTURA' : 'LEYENDO',
    progreso: Math.max(0, Math.min(100, fila.lastProgress ?? 0)),
    paginaActual: fila.currentPage,
    paginasTotales: fila.personalTotalPages ?? fila.book.totalPages,
    nota: fila.progressNote ?? '',
    fecha: (fila.progressUpdatedAt ?? fila.startedAt)?.toISOString() ?? '',
    ...(reacciones.get(fila.id) ?? { reacciones: contarReaccionesProgreso([]), miReaccion: null }),
  };
}

const SELECCION_LECTURA = {
  id: true,
  status: true,
  lastProgress: true,
  currentPage: true,
  personalTotalPages: true,
  progressNote: true,
  progressUpdatedAt: true,
  startedAt: true,
  book: {
    select: {
      id: true,
      title: true,
      coverUrl: true,
      totalPages: true,
      author: { select: { name: true } },
    },
  },
} as const;

/// Lo que una amistad enseña de sí misma, respetando sus interruptores.
export async function getPerfilAmistad(yo: string, nombre: string) {
  const amistades = await amistadesQueComparten(yo);
  const amiga = amistades.find((a) => a.name.toLowerCase() === String(nombre ?? '').trim().toLowerCase());
  if (!amiga) return { ok: false, mensaje: 'Esa persona no está en tus amistades.' };

  const compartido: PrivacidadAmistades = {
    leyendo: amiga.friendsSeeReading,
    biblioteca: amiga.friendsSeeLibrary,
    resenas: amiga.friendsSeeReviews,
  };

  const [leyendo, terminados, pendientes, totales, resenas] = await Promise.all([
    compartido.leyendo
      ? prisma.library.findMany({
          where: { userId: amiga.id, status: { in: [ReadingStatus.READING, ReadingStatus.REREADING] }, book: { deletedAt: null } },
          select: SELECCION_LECTURA,
          orderBy: [{ progressUpdatedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
          take: 10,
        })
      : Promise.resolve([]),
    compartido.leyendo
      ? prisma.readingCompletion.findMany({
          where: { userId: amiga.id, book: { deletedAt: null } },
          select: { id: true, finishedAt: true, rating: true, book: { select: { id: true, title: true, coverUrl: true } } },
          orderBy: { finishedAt: 'desc' },
          take: 12,
        })
      : Promise.resolve([]),
    compartido.biblioteca
      ? prisma.library.findMany({
          where: { userId: amiga.id, status: ReadingStatus.PENDING, book: { deletedAt: null } },
          select: { id: true, book: { select: { id: true, title: true, coverUrl: true } } },
          orderBy: { createdAt: 'desc' },
          take: 12,
        })
      : Promise.resolve([]),
    compartido.biblioteca
      ? Promise.all([
          prisma.library.count({ where: { userId: amiga.id, status: ReadingStatus.PENDING, book: { deletedAt: null } } }),
          prisma.readingCompletion.count({ where: { userId: amiga.id } }),
        ])
      : Promise.resolve(null),
    compartido.resenas
      ? prisma.review.findMany({
          where: { userId: amiga.id, deletedAt: null, book: { deletedAt: null } },
          select: { id: true, rating: true, review: true, containsSpoilers: true, createdAt: true, book: { select: { id: true, title: true, coverUrl: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
      : Promise.resolve([]),
  ]);

  const reacciones = await reaccionesDe(leyendo.map((l) => l.id), yo);

  return {
    ok: true,
    nombre: amiga.name,
    avatarUrl: amiga.avatarUrl ?? '',
    bio: amiga.bio ?? '',
    compartido,
    leyendo: leyendo.map((l) => itemLectura(l, reacciones)),
    terminados: terminados.map((t) => ({
      bookId: t.book.id,
      titulo: t.book.title,
      coverUrl: t.book.coverUrl ?? '',
      fecha: t.finishedAt.toISOString(),
      valoracion: compartido.resenas ? t.rating : null,
    })),
    pendientes: pendientes.map((p) => ({ bookId: p.book.id, titulo: p.book.title, coverUrl: p.book.coverUrl ?? '' })),
    totalPendientes: totales ? totales[0] : null,
    totalTerminados: totales ? totales[1] : null,
    resenas: resenas.map((r) => ({
      bookId: r.book.id,
      titulo: r.book.title,
      coverUrl: r.book.coverUrl ?? '',
      valoracion: r.rating,
      // Una reseña con spoilers no se enseña entera.
      texto: r.containsSpoilers ? '' : (r.review ?? ''),
      contieneSpoilers: r.containsSpoilers,
      fecha: r.createdAt.toISOString(),
    })),
  };
}

/// Lo último que han hecho tus amistades: qué leen ahora y qué han terminado.
export async function getActividadAmistades(yo: string) {
  const amistades = (await amistadesQueComparten(yo)).filter((a) => a.friendsSeeReading);
  if (amistades.length === 0) return { ok: true, items: [] };
  const ids = amistades.map((a) => a.id);
  const porId = new Map(amistades.map((a) => [a.id, a]));
  const desde = new Date(Date.now() - DIAS_ACTIVIDAD * 24 * 60 * 60 * 1000);

  const [leyendo, terminados] = await Promise.all([
    prisma.library.findMany({
      where: { userId: { in: ids }, status: { in: [ReadingStatus.READING, ReadingStatus.REREADING] }, book: { deletedAt: null } },
      select: { ...SELECCION_LECTURA, userId: true },
      orderBy: [{ progressUpdatedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
      take: MAX_ACTIVIDAD,
    }),
    prisma.readingCompletion.findMany({
      where: { userId: { in: ids }, finishedAt: { gte: desde }, book: { deletedAt: null } },
      select: { id: true, userId: true, finishedAt: true, rating: true, book: { select: { id: true, title: true, coverUrl: true } } },
      orderBy: { finishedAt: 'desc' },
      take: MAX_ACTIVIDAD,
    }),
  ]);
  const reacciones = await reaccionesDe(leyendo.map((l) => l.id), yo);

  const items = [
    ...leyendo.map((l) => {
      const persona = porId.get(l.userId)!;
      return { tipo: 'LEYENDO', nombre: persona.name, avatarUrl: persona.avatarUrl ?? '', ...itemLectura(l, reacciones) };
    }),
    ...terminados.map((t) => {
      const persona = porId.get(t.userId)!;
      return {
        tipo: 'TERMINADO',
        nombre: persona.name,
        avatarUrl: persona.avatarUrl ?? '',
        bookId: t.book.id,
        titulo: t.book.title,
        coverUrl: t.book.coverUrl ?? '',
        fecha: t.finishedAt.toISOString(),
        valoracion: persona.friendsSeeReviews ? t.rating : null,
      };
    }),
  ]
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, MAX_ACTIVIDAD);
  return { ok: true, items };
}
