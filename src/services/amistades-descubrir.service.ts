import { NotificationType, ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { backgroundError } from '../logging/logger.js';
import { amistadesQueComparten } from './amistades-ver.service.js';
import { createNotification } from './notifications.service.js';
import { crearLimitador } from './amistades-core.js';

const MAX_AMIGAS_AFINIDAD = 60;
const DIAS_RESUMEN = 7;

// ─────────────────────────────────────────────────────────────────────────────
// ¿Quién lo ha leído? (ficha de un libro)
// ─────────────────────────────────────────────────────────────────────────────

/// Qué amistades tienen este libro: leyéndolo, terminado (con su nota si la comparten)
/// o pendiente. Respeta los interruptores: «lo que leo» para el progreso, «mi biblioteca»
/// para terminados y pendientes, «mis reseñas» para la nota.
export async function getAmigosDelLibro(yo: string, bookId: string) {
  const amistades = await amistadesQueComparten(yo);
  if (amistades.length === 0) return { ok: true, items: [] };
  const porId = new Map(amistades.map((a) => [a.id, a]));
  const filas = await prisma.library.findMany({
    where: { bookId: String(bookId ?? '').trim(), userId: { in: [...porId.keys()] } },
    select: { userId: true, status: true, lastProgress: true, finishedAt: true },
  });
  const terminadas = filas.filter((f) => f.status === ReadingStatus.FINISHED).map((f) => f.userId);
  const notas = terminadas.length
    ? await prisma.review.findMany({
        where: { bookId: String(bookId).trim(), userId: { in: terminadas }, deletedAt: null },
        select: { userId: true, rating: true },
      })
    : [];
  const notaDe = new Map(notas.map((n) => [n.userId, n.rating]));

  const orden = { LEYENDO: 0, TERMINADO: 1, PENDIENTE: 2 } as const;
  const items = filas
    .map((f) => {
      const p = porId.get(f.userId)!;
      const leyendo = f.status === ReadingStatus.READING || f.status === ReadingStatus.REREADING;
      const termino = f.status === ReadingStatus.FINISHED;
      const pendiente = f.status === ReadingStatus.PENDING;
      if (leyendo && !p.friendsSeeReading) return null;
      if ((termino || pendiente) && !p.friendsSeeLibrary) return null;
      if (!leyendo && !termino && !pendiente) return null;
      return {
        nombre: p.name,
        avatarUrl: p.avatarUrl ?? '',
        estado: (leyendo ? 'LEYENDO' : termino ? 'TERMINADO' : 'PENDIENTE') as keyof typeof orden,
        progreso: leyendo ? Math.max(0, Math.min(100, f.lastProgress ?? 0)) : null,
        valoracion: termino && p.friendsSeeReviews ? (notaDe.get(f.userId) ?? null) : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre, 'es'));
  return { ok: true, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// Afinidad con tus amistades
// ─────────────────────────────────────────────────────────────────────────────

export type FilaAfinidad = { bookId: string; rating: number | null; genero: string };

/// Cálculo puro: qué tienen en común dos personas (libros terminados y su nota).
export function calcularAfinidad(mias: FilaAfinidad[], suyas: FilaAfinidad[]) {
  const miasPor = new Map(mias.map((f) => [f.bookId, f]));
  const comunes = suyas.filter((f) => miasPor.has(f.bookId));
  const generos = new Map<string, number>();
  for (const c of comunes) generos.set(c.genero, (generos.get(c.genero) ?? 0) + 1);
  const topGeneros = [...generos.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .slice(0, 3)
    .map(([g]) => g);
  const conNota = comunes.filter((c) => c.rating != null && miasPor.get(c.bookId)!.rating != null);
  const notasParecidas =
    conNota.length >= 3 &&
    conNota.reduce((s, c) => s + Math.abs((c.rating as number) - (miasPor.get(c.bookId)!.rating as number)), 0) /
      conNota.length <=
      0.6;
  const base = Math.min(mias.length, suyas.length);
  return {
    enComun: comunes.length,
    // Proporción sobre la biblioteca más pequeña: 100 % = todo lo de una está en la otra.
    afinidad: base === 0 ? 0 : Math.round((100 * comunes.length) / base),
    generos: topGeneros,
    notasParecidas,
  };
}

/// Con quién coincides más: libros terminados en común, géneros y si puntuáis parecido.
/// Solo con amistades que dejan ver su biblioteca.
export async function getAfinidadAmigos(yo: string) {
  const amistades = (await amistadesQueComparten(yo))
    .filter((a) => a.friendsSeeLibrary)
    .slice(0, MAX_AMIGAS_AFINIDAD);
  if (amistades.length === 0) return { ok: true, items: [] };
  const filas = await prisma.readingCompletion.findMany({
    where: { userId: { in: [yo, ...amistades.map((a) => a.id)] }, book: { deletedAt: null } },
    select: { userId: true, bookId: true, rating: true, book: { select: { genre: { select: { name: true } } } } },
  });
  const porUsuario = new Map<string, Map<string, FilaAfinidad>>();
  for (const f of filas) {
    const m = porUsuario.get(f.userId) ?? new Map<string, FilaAfinidad>();
    m.set(f.bookId, { bookId: f.bookId, rating: f.rating ?? null, genero: f.book.genre.name });
    porUsuario.set(f.userId, m);
  }
  const mias = [...(porUsuario.get(yo)?.values() ?? [])];
  const items = amistades
    .map((a) => ({
      nombre: a.name,
      avatarUrl: a.avatarUrl ?? '',
      ...calcularAfinidad(mias, [...(porUsuario.get(a.id)?.values() ?? [])]),
    }))
    .sort((a, b) => b.enComun - a.enComun || b.afinidad - a.afinidad || a.nombre.localeCompare(b.nombre, 'es'));
  return { ok: true, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen semanal
// ─────────────────────────────────────────────────────────────────────────────

/// Lo que han leído tus amistades en los últimos 7 días: libros terminados, el libro
/// más terminado, quién más ha terminado y la nota media. Solo de quien comparte
/// lo que lee.
export async function getResumenSemanalAmigos(yo: string) {
  const amistades = (await amistadesQueComparten(yo)).filter((a) => a.friendsSeeReading);
  if (amistades.length === 0) return { ok: true, terminados: 0, personas: 0 };
  const porId = new Map(amistades.map((a) => [a.id, a]));
  const desde = new Date(Date.now() - DIAS_RESUMEN * 24 * 60 * 60 * 1000);
  const filas = await prisma.readingCompletion.findMany({
    where: { userId: { in: [...porId.keys()] }, finishedAt: { gte: desde }, book: { deletedAt: null } },
    select: { userId: true, bookId: true, book: { select: { title: true, coverUrl: true } } },
  });
  if (filas.length === 0) return { ok: true, terminados: 0, personas: 0 };
  const porLibro = new Map<string, { titulo: string; coverUrl: string; veces: number }>();
  const porPersona = new Map<string, number>();
  for (const f of filas) {
    const l = porLibro.get(f.bookId) ?? { titulo: f.book.title, coverUrl: f.book.coverUrl ?? '', veces: 0 };
    l.veces++;
    porLibro.set(f.bookId, l);
    porPersona.set(f.userId, (porPersona.get(f.userId) ?? 0) + 1);
  }
  const [libroTop] = [...porLibro.entries()].sort((a, b) => b[1].veces - a[1].veces || a[1].titulo.localeCompare(b[1].titulo, 'es'));
  const [personaTop] = [...porPersona.entries()].sort(
    (a, b) => b[1] - a[1] || porId.get(a[0])!.name.localeCompare(porId.get(b[0])!.name, 'es'),
  );
  return {
    ok: true,
    terminados: filas.length,
    personas: porPersona.size,
    libroMasLeido: { bookId: libroTop![0], titulo: libroTop![1].titulo, coverUrl: libroTop![1].coverUrl, veces: libroTop![1].veces },
    quienMas: { nombre: porId.get(personaTop![0])!.name, avatarUrl: porId.get(personaTop![0])!.avatarUrl ?? '', total: personaTop![1] },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// «Recomiéndame un libro»
// ─────────────────────────────────────────────────────────────────────────────

const puedePedir = crearLimitador(6);

/// Pide a una amistad que te recomiende un libro: le llega un aviso y ella usa
/// «Recomendar a un amigo». Como mucho una vez a la semana por persona.
export async function pedirRecomendacion(yo: string, nombre: string) {
  if (!puedePedir(yo)) return { ok: false, mensaje: 'Vas muy rápido. Espera un momento y vuelve a intentarlo.' };
  const [yoUser, amistades] = await Promise.all([
    prisma.user.findUnique({ where: { id: yo }, select: { id: true, name: true } }),
    amistadesQueComparten(yo),
  ]);
  const amiga = amistades.find((a) => a.name.toLowerCase() === String(nombre ?? '').trim().toLowerCase());
  if (!yoUser || !amiga) return { ok: false, mensaje: 'Solo puedes pedírselo a una amistad.' };
  const hace7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const ya = await prisma.notification.findFirst({
    where: {
      userId: amiga.id,
      tipo: NotificationType.AMISTAD_PIDE_RECOMENDACION,
      createdAt: { gte: hace7 },
      extra: { contains: `"de":"${yo}"` },
    },
    select: { id: true },
  });
  if (ya) return { ok: false, mensaje: `Ya le has pedido una recomendación a ${amiga.name} esta semana.` };
  await createNotification({
    userId: amiga.id,
    tipo: NotificationType.AMISTAD_PIDE_RECOMENDACION,
    titulo: '💡 ¿Qué me recomiendas?',
    mensaje: `${yoUser.name} busca su próxima lectura y te pide una recomendación`,
    extra: { de: yo, nombre: yoUser.name },
  }).catch(backgroundError('amistad_pide_recomendacion_failed'));
  return { ok: true, mensaje: `Se lo hemos pedido a ${amiga.name} 💜` };
}
