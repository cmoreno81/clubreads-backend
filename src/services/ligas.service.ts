/**
 * Ligas de ClubReads — ranking individual por temporadas quincenales.
 *
 * Filosofía: premia el HÁBITO (check-ins, racha, páginas) por encima del
 * VOLUMEN (nº de libros), para que cualquier miembro pueda competir y para
 * no incentivar meter libros basura de 20 páginas.
 *
 * Los puntos "vivos" son la suma de RankingPointEvent de la temporada en
 * curso y se resetean cada quincena. Al cerrar una temporada se guarda un
 * snapshot en RankingSeasonResult para el histórico permanente.
 *
 * El cálculo es un RECÁLCULO idempotente desde las tablas fuente
 * (DailyCheckin, ReadingSession, ReadingCompletion, Review, sagas, Libro
 * del año). No hay hooks repartidos por otros servicios: recalcular una
 * temporada siempre da el mismo resultado y revertir una acción (des-
 * finalizar un libro, quitar una marca de racha) desaparece sola en el
 * siguiente recálculo.
 */

import type { RankingEventType } from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  notifyLigaCierreProximo,
  notifyLigaResultado,
  yaAvisadoCierreLiga,
} from './notifications.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Temporadas
// ─────────────────────────────────────────────────────────────────────────────

const TZ = 'Europe/Madrid';
export const SEASON_LENGTH_DAYS = 14;

/**
 * Ancla de la primera temporada (temporada 0). Es la fecha de lanzamiento
 * de la feature: nada anterior a esta fecha puntúa ("empezamos limpios").
 * Debe ser un "YYYY-MM-DD". Ajustar a la fecha real de despliegue.
 */
export const SEASON_EPOCH = '2026-09-10';

const MS_DAY = 86_400_000;

function dateOnlyToUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDaysStr(dateStr: string, days: number): string {
  return new Date(dateOnlyToUtcMs(dateStr) + days * MS_DAY)
    .toISOString()
    .slice(0, 10);
}

/** Días completos entre dos "YYYY-MM-DD" (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateOnlyToUtcMs(b) - dateOnlyToUtcMs(a)) / MS_DAY);
}

/** Nº de temporada de un día "YYYY-MM-DD". -1 si es anterior al lanzamiento. */
export function seasonNumberForDate(dateStr: string): number {
  const diff = daysBetween(SEASON_EPOCH, dateStr);
  if (diff < 0) return -1;
  return Math.floor(diff / SEASON_LENGTH_DAYS);
}

/** Ventana [startDate, endDate) de una temporada, en "YYYY-MM-DD". */
export function seasonWindow(season: number): {
  startDate: string;
  endDate: string;
} {
  const startDate = addDaysStr(SEASON_EPOCH, season * SEASON_LENGTH_DAYS);
  const endDate = addDaysStr(startDate, SEASON_LENGTH_DAYS);
  return { startDate, endDate };
}

/** Día de hoy ("YYYY-MM-DD") en la zona horaria de referencia (Madrid). */
export function todayInTz(now: Date = new Date()): string {
  // 'en-CA' formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

/** Año-mes ("YYYY-MM") de un instante, en Madrid. */
function yearMonthInTz(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
  })
    .format(date)
    .slice(0, 7);
}

function tzOffsetMs(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  );
  return asUtc - date.getTime();
}

/** Instante UTC correspondiente a las 00:00 (Madrid) de un "YYYY-MM-DD". */
export function tzMidnightUtc(dateStr: string): Date {
  const naive = new Date(`${dateStr}T00:00:00Z`);
  return new Date(naive.getTime() - tzOffsetMs(naive));
}

export function currentSeasonNumber(now: Date = new Date()): number {
  return Math.max(0, seasonNumberForDate(todayInTz(now)));
}

export function seasonEndsAt(season: number): Date {
  return tzMidnightUtc(seasonWindow(season).endDate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Puntos (funciones puras)
// ─────────────────────────────────────────────────────────────────────────────

export const PUNTOS = {
  CHECKIN: 10,
  FIRST_BOOK_OF_MONTH: 25,
  SAGA_COMPLETED: 100,
  REVIEW: 15,
  BOOK_OF_YEAR_PICK: 10,
  QUIZ: 20,
  BOOK_FINISHED: 40,
  BOOK_FINISHED_REDUCIDO: 20, // relectura o libro de <50 páginas
} as const;

export const STREAK_BONUS_TOPE = 15;
export const PAGES_POR_PUNTO = 20;
export const PAGES_PUNTOS_TOPE = 10;
export const LIBRO_CORTO_PAGINAS = 50;
export const RESENA_MIN_CARACTERES = 200;

export function puntosPorPaginas(paginas: number): number {
  if (!Number.isFinite(paginas) || paginas <= 0) return 0;
  return Math.min(Math.floor(paginas / PAGES_POR_PUNTO), PAGES_PUNTOS_TOPE);
}

export function bonusPorRacha(longitudRacha: number): number {
  if (!Number.isFinite(longitudRacha) || longitudRacha <= 0) return 0;
  return Math.min(Math.trunc(longitudRacha), STREAK_BONUS_TOPE);
}

export function puntosPorLibro(opts: {
  isReread: boolean;
  totalPages: number | null;
}): number {
  if (opts.isReread) return PUNTOS.BOOK_FINISHED_REDUCIDO;
  if (opts.totalPages != null && opts.totalPages < LIBRO_CORTO_PAGINAS) {
    return PUNTOS.BOOK_FINISHED_REDUCIDO;
  }
  return PUNTOS.BOOK_FINISHED;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recálculo de una temporada
// ─────────────────────────────────────────────────────────────────────────────

type EventoBorrador = {
  type: RankingEventType;
  points: number;
  dedupeKey: string;
};

/** Longitud de la racha de check-ins que termina EXACTAMENTE en `dia`. */
function longitudRachaHasta(dia: string, diasConCheckin: Set<string>): number {
  let n = 0;
  let cursor = dia;
  while (diasConCheckin.has(cursor)) {
    n += 1;
    cursor = addDaysStr(cursor, -1);
  }
  return n;
}

/**
 * Calcula todos los eventos puntuables de un usuario en una temporada,
 * leyendo las tablas fuente. No escribe nada.
 */
export async function calcularEventosTemporada(
  userId: string,
  season: number,
): Promise<EventoBorrador[]> {
  const { startDate, endDate } = seasonWindow(season);
  const startInstant = tzMidnightUtc(startDate);
  const endInstant = tzMidnightUtc(endDate);
  const eventos: EventoBorrador[] = [];

  // ── Check-ins + bonus de racha ──────────────────────────────────────────
  const checkins = await prisma.dailyCheckin.findMany({
    where: { userId, date: { gte: startDate, lt: endDate } },
    select: { date: true },
    orderBy: { date: 'asc' },
  });

  if (checkins.length > 0) {
    // Para calcular la racha necesitamos también días anteriores a la
    // temporada (una racha puede venir de lejos).
    const lookbackDesde = addDaysStr(startDate, -400);
    const historicos = await prisma.dailyCheckin.findMany({
      where: { userId, date: { gte: lookbackDesde, lt: endDate } },
      select: { date: true },
    });
    const diasConCheckin = new Set(historicos.map((c) => c.date));

    for (const { date } of checkins) {
      eventos.push({
        type: 'CHECKIN',
        points: PUNTOS.CHECKIN,
        dedupeKey: `checkin:${date}`,
      });
      const bonus = bonusPorRacha(longitudRachaHasta(date, diasConCheckin));
      if (bonus > 0) {
        eventos.push({
          type: 'STREAK_BONUS',
          points: bonus,
          dedupeKey: `streak:${date}`,
        });
      }
    }
  }

  // ── Páginas leídas por día ─────────────────────────────────────────────
  const sesiones = await prisma.readingSession.findMany({
    where: { userId, date: { gte: startDate, lt: endDate }, pagesRead: { gt: 0 } },
    select: { date: true, pagesRead: true },
  });
  for (const s of sesiones) {
    const p = puntosPorPaginas(s.pagesRead);
    if (p > 0) {
      eventos.push({ type: 'PAGES', points: p, dedupeKey: `pages:${s.date}` });
    }
  }

  // ── Libros terminados ─────────────────────────────────────────────────
  const completions = await prisma.readingCompletion.findMany({
    where: { userId, finishedAt: { gte: startInstant, lt: endInstant } },
    select: {
      id: true,
      isReread: true,
      finishedAt: true,
      book: { select: { id: true, totalPages: true, seriesId: true } },
    },
  });
  for (const c of completions) {
    eventos.push({
      type: 'BOOK_FINISHED',
      points: puntosPorLibro({
        isReread: c.isReread,
        totalPages: c.book.totalPages,
      }),
      dedupeKey: `book:${c.id}`,
    });
  }

  // ── Primer libro terminado del mes ────────────────────────────────────
  if (completions.length > 0) {
    const todas = await prisma.readingCompletion.findMany({
      where: { userId },
      select: { finishedAt: true },
      orderBy: { finishedAt: 'asc' },
    });
    const primeraPorMes = new Map<string, Date>();
    for (const { finishedAt } of todas) {
      const ym = yearMonthInTz(finishedAt);
      if (!primeraPorMes.has(ym)) primeraPorMes.set(ym, finishedAt);
    }
    for (const [ym, cuando] of primeraPorMes) {
      if (cuando >= startInstant && cuando < endInstant) {
        eventos.push({
          type: 'FIRST_BOOK_OF_MONTH',
          points: PUNTOS.FIRST_BOOK_OF_MONTH,
          dedupeKey: `firstbook:${ym}`,
        });
      }
    }
  }

  // ── Sagas completadas ────────────────────────────────────────────────
  const seriesEnVentana = [
    ...new Set(
      completions
        .map((c) => c.book.seriesId)
        .filter((id): id is string => id != null),
    ),
  ];
  for (const seriesId of seriesEnVentana) {
    const librosSaga = await prisma.book.findMany({
      where: { seriesId, deletedAt: null },
      select: { id: true },
    });
    if (librosSaga.length === 0) continue;
    const idsSaga = new Set(librosSaga.map((b) => b.id));

    const misCompletionsSaga = await prisma.readingCompletion.findMany({
      where: { userId, bookId: { in: [...idsSaga] } },
      select: { bookId: true, finishedAt: true },
    });
    const librosTerminados = new Set(misCompletionsSaga.map((c) => c.bookId));
    const sagaCompleta = [...idsSaga].every((id) => librosTerminados.has(id));
    if (!sagaCompleta) continue;

    // El tomo que "cierra" la saga es el de finishedAt más reciente.
    const cierre = misCompletionsSaga.reduce((max, c) =>
      c.finishedAt > max.finishedAt ? c : max,
    );
    if (cierre.finishedAt >= startInstant && cierre.finishedAt < endInstant) {
      eventos.push({
        type: 'SAGA_COMPLETED',
        points: PUNTOS.SAGA_COMPLETED,
        dedupeKey: `saga:${seriesId}`,
      });
    }
  }

  // ── Reseñas con texto ────────────────────────────────────────────────
  const resenas = await prisma.review.findMany({
    where: {
      userId,
      deletedAt: null,
      review: { not: null },
      updatedAt: { gte: startInstant, lt: endInstant },
    },
    select: { bookId: true, review: true },
  });
  const librosResenados = new Set<string>();
  for (const r of resenas) {
    if (
      (r.review ?? '').trim().length >= RESENA_MIN_CARACTERES &&
      !librosResenados.has(r.bookId)
    ) {
      librosResenados.add(r.bookId);
      eventos.push({
        type: 'REVIEW',
        points: PUNTOS.REVIEW,
        dedupeKey: `review:${r.bookId}`,
      });
    }
  }

  // ── Elección de Libro del año (mes) ─────────────────────────────────
  const eleccionesBoty = await prisma.bookOfYearMonthlySelection.findMany({
    where: { userId, updatedAt: { gte: startInstant, lt: endInstant } },
    select: { year: true, month: true },
  });
  for (const e of eleccionesBoty) {
    eventos.push({
      type: 'BOOK_OF_YEAR_PICK',
      points: PUNTOS.BOOK_OF_YEAR_PICK,
      dedupeKey: `boty:${e.year}-${String(e.month).padStart(2, '0')}`,
    });
  }

  return eventos;
}

/** Recalcula y persiste (idempotente) los eventos de un usuario/temporada. */
export async function recalcularTemporada(
  userId: string,
  season: number,
): Promise<number> {
  const eventos = await calcularEventosTemporada(userId, season);
  await prisma.$transaction([
    prisma.rankingPointEvent.deleteMany({
      where: { userId, seasonNumber: season },
    }),
    prisma.rankingPointEvent.createMany({
      data: eventos.map((e) => ({
        userId,
        seasonNumber: season,
        type: e.type,
        points: e.points,
        dedupeKey: e.dedupeKey,
      })),
      skipDuplicates: true,
    }),
  ]);
  return eventos.reduce((sum, e) => sum + e.points, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Participación (opt-in)
// ─────────────────────────────────────────────────────────────────────────────

export async function esParticipante(userId: string): Promise<boolean> {
  const p = await prisma.rankingParticipation.findUnique({ where: { userId } });
  return p != null;
}

export async function unirseALaLiga(userId: string) {
  await prisma.rankingParticipation.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return { ok: true as const };
}

export async function salirDeLaLiga(userId: string) {
  await prisma.rankingParticipation
    .delete({ where: { userId } })
    .catch(() => undefined);
  return { ok: true as const };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabla de la liga
// ─────────────────────────────────────────────────────────────────────────────

const RECALCULO_TABLA_MAX_PARTICIPANTES = 250;

type FilaTabla = {
  puesto: number;
  userId: string;
  nombre: string;
  avatarUrl: string | null;
  puntos: number;
  esTu: boolean;
};

async function tablaTemporada(season: number): Promise<FilaTabla[]> {
  const participantes = await prisma.rankingParticipation.findMany({
    select: { userId: true },
  });
  const ids = participantes.map((p) => p.userId);
  if (ids.length === 0) return [];

  const sumas = await prisma.rankingPointEvent.groupBy({
    by: ['userId'],
    where: { seasonNumber: season, userId: { in: ids } },
    _sum: { points: true },
  });
  const puntosPorUser = new Map(
    sumas.map((s) => [s.userId, s._sum.points ?? 0]),
  );

  const usuarios = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, avatarUrl: true },
  });

  const filas = usuarios
    .map((u) => ({
      userId: u.id,
      nombre: u.name,
      avatarUrl: u.avatarUrl,
      puntos: puntosPorUser.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre));

  return filas.map((f, i) => ({
    puesto: i + 1,
    userId: f.userId,
    nombre: f.nombre,
    avatarUrl: f.avatarUrl,
    puntos: f.puntos,
    esTu: false,
  }));
}

export async function getLiga(userId: string, now: Date = new Date()) {
  const season = currentSeasonNumber(now);
  const terminaEn = seasonEndsAt(season).toISOString();
  const participando = await esParticipante(userId);

  if (!participando) {
    return {
      ok: true as const,
      participando: false,
      temporada: { numero: season, terminaEn },
    };
  }

  // Mantener el ranking fresco. En beta (pocos participantes) se recalcula
  // toda la tabla en cada carga; si crece, solo tu fila y lo demás lo deja
  // al job periódico.
  const totalParticipantes = await prisma.rankingParticipation.count();
  if (totalParticipantes <= RECALCULO_TABLA_MAX_PARTICIPANTES) {
    const ids = (
      await prisma.rankingParticipation.findMany({ select: { userId: true } })
    ).map((p) => p.userId);
    for (const id of ids) {
      await recalcularTemporada(id, season).catch(() => undefined);
    }
  } else {
    await recalcularTemporada(userId, season).catch(() => undefined);
  }

  const tabla = await tablaTemporada(season);
  const miFila = tabla.find((f) => f.userId === userId);
  const miPuesto = miFila?.puesto ?? tabla.length + 1;
  const misPuntos = miFila?.puntos ?? 0;

  // Top 10 + ventana de ±2 alrededor de mí si estoy fuera del top.
  const visibles = new Map<number, FilaTabla>();
  for (const f of tabla.slice(0, 10)) visibles.set(f.puesto, f);
  for (const f of tabla) {
    if (Math.abs(f.puesto - miPuesto) <= 2) visibles.set(f.puesto, f);
  }
  const filas = [...visibles.values()]
    .sort((a, b) => a.puesto - b.puesto)
    .map((f) => ({ ...f, esTu: f.userId === userId }));

  // Histórico permanente.
  const resultados = await prisma.rankingSeasonResult.findMany({
    where: { userId },
    select: { rank: true, totalPoints: true },
  });
  const historico = {
    temporadasJugadas: resultados.length,
    mejorPuesto: resultados.length
      ? Math.min(...resultados.map((r) => r.rank))
      : null,
    mejorPuntuacion: resultados.length
      ? Math.max(...resultados.map((r) => r.totalPoints))
      : null,
    podios: resultados.filter((r) => r.rank <= 3).length,
  };

  return {
    ok: true as const,
    participando: true,
    temporada: {
      numero: season,
      terminaEn,
      totalParticipantes,
    },
    miPuesto,
    misPuntos,
    tabla: filas,
    historico,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de temporada (job)
// ─────────────────────────────────────────────────────────────────────────────

/** Recalcula, ordena y congela el resultado de una temporada. Idempotente. */
export async function cerrarTemporada(season: number): Promise<number> {
  const participantes = await prisma.rankingParticipation.findMany({
    select: { userId: true },
  });
  for (const { userId } of participantes) {
    await recalcularTemporada(userId, season).catch(() => undefined);
  }

  const tabla = await tablaTemporada(season);
  for (const fila of tabla) {
    await prisma.rankingSeasonResult.upsert({
      where: {
        userId_seasonNumber: { userId: fila.userId, seasonNumber: season },
      },
      create: {
        userId: fila.userId,
        seasonNumber: season,
        totalPoints: fila.puntos,
        rank: fila.puesto,
      },
      update: { totalPoints: fila.puntos, rank: fila.puesto },
    });
  }

  // Notificación de resultado a cada participante (best-effort).
  try {
    await notifyLigaResultado(
      season,
      tabla.map((f) => ({
        userId: f.userId,
        rank: f.puesto,
        total: tabla.length,
        puntos: f.puntos,
      })),
    );
  } catch (error) {
    console.error('Ligas: no se pudo notificar el resultado:', error);
  }

  return tabla.length;
}

/**
 * Aviso de cierre inminente: cuando falten <=24 h para el fin de la
 * temporada en curso, avisa una sola vez a cada participante de su
 * posición y de a cuántos puntos está el podio. Idempotente.
 */
export async function avisarCierreProximo(
  season: number,
  now: Date = new Date(),
): Promise<number> {
  const msRestantes = seasonEndsAt(season).getTime() - now.getTime();
  const horasRestantes = msRestantes / 3_600_000;
  if (horasRestantes <= 0 || horasRestantes > 24) return 0;

  const tabla = await tablaTemporada(season);
  if (tabla.length === 0) return 0;
  const puntosPodio = tabla[Math.min(2, tabla.length - 1)].puntos;

  const entradas: {
    userId: string;
    rank: number;
    total: number;
    puntosAlPodio: number;
    horasRestantes: number;
  }[] = [];
  for (const fila of tabla) {
    if (await yaAvisadoCierreLiga(fila.userId, season)) continue;
    entradas.push({
      userId: fila.userId,
      rank: fila.puesto,
      total: tabla.length,
      puntosAlPodio: Math.max(0, puntosPodio - fila.puntos),
      horasRestantes,
    });
  }

  try {
    await notifyLigaCierreProximo(season, entradas);
  } catch (error) {
    console.error('Ligas: no se pudo notificar el cierre próximo:', error);
  }
  return entradas.length;
}

/** ¿Ya se cerró esta temporada? (existe al menos un snapshot). */
export async function temporadaCerrada(season: number): Promise<boolean> {
  const n = await prisma.rankingSeasonResult.count({
    where: { seasonNumber: season },
  });
  return n > 0;
}
