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

import type { MedalTier, RankingDivision, RankingEventType } from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  notifyLigaCierreProximo,
  notifyLigaRachaEnRiesgo,
  notifyLigaResultado,
  yaAvisadoCierreLiga,
  yaAvisadoRachaHoy,
} from './notifications.service.js';
import { getActiveDates } from './checkin.service.js';
import { madridMonthBounds } from './book-of-year.service.js';

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

/**
 * La elección del Libro del año de un mes puntúa solo si se hizo durante ese
 * mes o el siguiente. Así nadie suma de golpe los meses atrasados al entrar
 * en la app, y quien los rellenó antes de que existieran las Ligas no queda
 * en desventaja: todo el mundo puede ganar como mucho 10 puntos al mes.
 */
export function eleccionBotyEnPlazo(
  year: number,
  month: number,
  createdAt: Date,
): boolean {
  const { start } = madridMonthBounds(year, month);
  // El plazo acaba al empezar el mes M+2.
  const finIndice = year * 12 + (month - 1) + 2;
  const { start: fin } = madridMonthBounds(Math.floor(finIndice / 12), (finIndice % 12) + 1);
  return createdAt >= start && createdAt < fin;
}

/**
 * De las lecturas marcadas como terminadas SIN haber pasado por "Leyendo
 * ahora", devuelve los ids de la primera que se registró cada día (Madrid).
 * Quien no usa "Leyendo ahora" y marca cada libro al acabarlo puntúa igual;
 * quien vuelca su historial de golpe solo suma un libro ese día.
 */
export function primeraPorDia(lista: { id: string; createdAt: Date }[]): Set<string> {
  const porDia = new Map<string, { id: string; createdAt: Date }>();
  for (const c of lista) {
    const dia = todayInTz(c.createdAt);
    const actual = porDia.get(dia);
    if (
      !actual ||
      c.createdAt < actual.createdAt ||
      (c.createdAt.getTime() === actual.createdAt.getTime() && c.id < actual.id)
    ) {
      porDia.set(dia, c);
    }
  }
  return new Set([...porDia.values()].map((c) => c.id));
}

/**
 * Filtra las lecturas que puntúan: todas las seguidas en la app y, de las
 * demás, solo la primera registrada cada día (ver `primeraPorDia`).
 */
async function completionsQuePuntuan<
  T extends { id: string; trackedInApp: boolean; createdAt: Date },
>(userId: string, candidatas: T[]): Promise<T[]> {
  const sueltas = candidatas.filter((c) => !c.trackedInApp);
  if (sueltas.length === 0) return candidatas;
  const dias = sueltas.map((c) => todayInTz(c.createdAt)).sort();
  // Se mira el día completo, no solo las candidatas, para que el libro que
  // puntúa cada día sea siempre el mismo sea cual sea la consulta de origen.
  const delDia = await prisma.readingCompletion.findMany({
    where: {
      userId,
      trackedInApp: false,
      createdAt: {
        gte: tzMidnightUtc(dias[0]),
        lt: tzMidnightUtc(addDaysStr(dias[dias.length - 1], 1)),
      },
    },
    select: { id: true, createdAt: true },
  });
  const ganadoras = primeraPorDia(delDia);
  return candidatas.filter((c) => c.trackedInApp || ganadoras.has(c.id));
}

/** Margen tras terminar un libro para que su reseña siga puntuando. */
export const RESENA_PLAZO_DIAS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Recálculo de una temporada
// ─────────────────────────────────────────────────────────────────────────────

type EventoBorrador = {
  type: RankingEventType;
  points: number;
  dedupeKey: string;
};

/**
 * Longitud de la racha de días activos (check-in, progreso o libro
 * terminado — ver `getActiveDates` en checkin.service) que termina
 * EXACTAMENTE en `dia`.
 */
function longitudRachaHasta(dia: string, diasActivos: Set<string>): number {
  let n = 0;
  let cursor = dia;
  while (diasActivos.has(cursor)) {
    n += 1;
    cursor = addDaysStr(cursor, -1);
  }
  return n;
}

/** Igual que `longitudRachaHasta`, pero consultando la BD directamente. */
async function longitudRachaEnDb(userId: string, hastaDia: string): Promise<number> {
  const desde = addDaysStr(hastaDia, -400);
  const diasActivos = await getActiveDates(userId, desde, hastaDia);
  return longitudRachaHasta(hastaDia, diasActivos);
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
    // temporada (una racha puede venir de lejos), y no solo check-ins:
    // un día en el que solo se actualizó progreso también cuenta para no
    // romper la racha (misma definición que el mapa de calor).
    const lookbackDesde = addDaysStr(startDate, -400);
    const diasActivos = await getActiveDates(userId, lookbackDesde, addDaysStr(endDate, -1));

    for (const { date } of checkins) {
      eventos.push({
        type: 'CHECKIN',
        points: PUNTOS.CHECKIN,
        dedupeKey: `checkin:${date}`,
      });
      const bonus = bonusPorRacha(longitudRachaHasta(date, diasActivos));
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
  // Puntúan todos los libros leídos en la app (pasaron por "Leyendo ahora")
  // y, de los marcados directamente como terminados, uno al día. Así quien
  // entra nueva y vuelca su historial no arrasa en su primera quincena.
  const completions = await completionsQuePuntuan(
    userId,
    await prisma.readingCompletion.findMany({
      where: { userId, finishedAt: { gte: startInstant, lt: endInstant } },
      select: {
        id: true,
        isReread: true,
        finishedAt: true,
        trackedInApp: true,
        createdAt: true,
        book: { select: { id: true, totalPages: true, seriesId: true } },
      },
    }),
  );
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
    const todas = await completionsQuePuntuan(
      userId,
      await prisma.readingCompletion.findMany({
        where: { userId },
        select: { id: true, finishedAt: true, trackedInApp: true, createdAt: true },
        orderBy: { finishedAt: 'asc' },
      }),
    );
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

    // El tomo que "cierra" la saga es el de finishedAt más reciente. Los
    // tomos anteriores pueden ser lecturas pasadas, pero el bonus solo se da
    // si se cierra en esta temporada y al menos un tomo de la saga
    // puntúa en ella (`completions` ya viene filtrado así).
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
  // Solo puntúa la reseña de un libro que puntúa y escrita en los
  // RESENA_PLAZO_DIAS siguientes a terminarlo: reseñar libros antiguos o
  // retocar una reseña vieja no suma. Una reseña que ya puntuó en la
  // temporada anterior no vuelve a puntuar si se edita.
  const resenas = await prisma.review.findMany({
    where: {
      userId,
      deletedAt: null,
      review: { not: null },
      updatedAt: { gte: startInstant, lt: endInstant },
    },
    select: { bookId: true, review: true, updatedAt: true },
  });
  const resenasLargas = resenas.filter(
    (r) => (r.review ?? '').trim().length >= RESENA_MIN_CARACTERES,
  );
  const terminadosParaResena =
    resenasLargas.length === 0
      ? []
      : await completionsQuePuntuan(
          userId,
          await prisma.readingCompletion.findMany({
            where: {
              userId,
              bookId: { in: resenasLargas.map((r) => r.bookId) },
              finishedAt: {
                gte: new Date(startInstant.getTime() - RESENA_PLAZO_DIAS * MS_DAY),
                lt: endInstant,
              },
            },
            select: { id: true, bookId: true, finishedAt: true, trackedInApp: true, createdAt: true },
          }),
        );
  const yaPuntuadasAntes =
    resenasLargas.length === 0 || season === 0
      ? new Set<string>()
      : new Set(
          (
            await prisma.rankingPointEvent.findMany({
              where: {
                userId,
                seasonNumber: season - 1,
                type: 'REVIEW',
                dedupeKey: { in: resenasLargas.map((r) => `review:${r.bookId}`) },
              },
              select: { dedupeKey: true },
            })
          ).map((e) => e.dedupeKey),
        );
  const librosResenados = new Set<string>();
  for (const r of resenasLargas) {
    const leidoHacePoco = terminadosParaResena.some(
      (c) =>
        c.bookId === r.bookId &&
        c.finishedAt <= r.updatedAt &&
        r.updatedAt.getTime() - c.finishedAt.getTime() <= RESENA_PLAZO_DIAS * MS_DAY,
    );
    if (
      leidoHacePoco &&
      !yaPuntuadasAntes.has(`review:${r.bookId}`) &&
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
  // Cuenta la fecha de la PRIMERA elección (createdAt): cambiar de libro
  // después no vuelve a puntuar. Y solo si se hizo en plazo (ese mes o el
  // siguiente), para que rellenar meses atrasados no dé puntos.
  const eleccionesBoty = await prisma.bookOfYearMonthlySelection.findMany({
    where: { userId, createdAt: { gte: startInstant, lt: endInstant } },
    select: { year: true, month: true, createdAt: true },
  });
  for (const e of eleccionesBoty) {
    if (!eleccionBotyEnPlazo(e.year, e.month, e.createdAt)) continue;
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
// Divisiones (ascenso/descenso)
// ─────────────────────────────────────────────────────────────────────────────

/** De menor a mayor. Todo el mundo empieza en Bronce. */
export const ORDEN_DIVISIONES: RankingDivision[] = [
  'BRONCE',
  'PLATA',
  'ORO',
  'PLATINO',
  'DIAMANTE',
];

export function divisionSuperior(d: RankingDivision): RankingDivision {
  const i = ORDEN_DIVISIONES.indexOf(d);
  return ORDEN_DIVISIONES[Math.min(i + 1, ORDEN_DIVISIONES.length - 1)];
}

export function divisionInferior(d: RankingDivision): RankingDivision {
  const i = ORDEN_DIVISIONES.indexOf(d);
  return ORDEN_DIVISIONES[Math.max(i - 1, 0)];
}

/**
 * Cuántas personas suben y cuántas bajan en una división de `size`
 * participantes: ~20% arriba y ~20% abajo, dejando siempre a alguien sin
 * moverse en medio. Con menos de 3 personas no hay suficiente gente para
 * que ascender/descender tenga sentido, así que nadie se mueve.
 */
export function calcularCuotaAscensoDescenso(size: number): {
  suben: number;
  bajan: number;
} {
  if (size < 3) return { suben: 0, bajan: 0 };
  const cuota = Math.max(1, Math.round(size * 0.2));
  const tope = Math.floor((size - 1) / 2); // deja >=1 persona en medio
  const n = Math.min(cuota, tope);
  return { suben: n, bajan: n };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabla de la liga
// ─────────────────────────────────────────────────────────────────────────────

export type FilaTabla = {
  puesto: number;
  userId: string;
  nombre: string;
  avatarUrl: string | null;
  puntos: number;
  esTu: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tendencia (sube/baja puestos desde el último ciclo del cron)
// ─────────────────────────────────────────────────────────────────────────────

export type Tendencia = 'sube' | 'baja' | 'igual' | null;

/**
 * Compara la posición anterior con la actual. `previousRank` más alto que
 * `rank` significa que ha mejorado (puesto 8 → puesto 5 = sube 3).
 * `previousRank` null = aún no hay dato del ciclo anterior (recién unida).
 */
export function calcularTendencia(
  previousRank: number | null,
  rank: number,
): { tendencia: Tendencia; delta: number | null } {
  if (previousRank == null) return { tendencia: null, delta: null };
  const delta = previousRank - rank;
  return { tendencia: delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'igual', delta };
}

async function tendenciasPara(
  season: number,
  userIds: string[],
): Promise<Map<string, { tendencia: Tendencia; delta: number | null }>> {
  const mapa = new Map<string, { tendencia: Tendencia; delta: number | null }>();
  if (userIds.length === 0) return mapa;
  const snapshots = await prisma.rankingRankSnapshot.findMany({
    where: { seasonNumber: season, userId: { in: userIds } },
    select: { userId: true, rank: true, previousRank: true },
  });
  for (const s of snapshots) {
    mapa.set(s.userId, calcularTendencia(s.previousRank, s.rank));
  }
  return mapa;
}

/** Divisiones que tienen al menos una participante ahora mismo. */
async function divisionesEnUso(): Promise<RankingDivision[]> {
  const filas = await prisma.rankingParticipation.findMany({
    select: { division: true },
    distinct: ['division'],
  });
  return filas.map((f) => f.division);
}

/**
 * Registra la posición actual de cada participante (dentro de su división)
 * para poder comparar en el siguiente ciclo. Se llama desde el cron
 * `ligas:recompute`, DESPUÉS de recalcular los puntos de todo el mundo —
 * nunca desde `getLiga` (que solo recalcula la fila de quien mira la
 * pantalla).
 */
export async function actualizarTendencias(season: number): Promise<void> {
  for (const division of await divisionesEnUso()) {
    const tabla = await tablaTemporada(season, division);
    if (tabla.length === 0) continue;

    const existentes = await prisma.rankingRankSnapshot.findMany({
      where: { seasonNumber: season, userId: { in: tabla.map((f) => f.userId) } },
      select: { userId: true, rank: true },
    });
    const rankAnterior = new Map(existentes.map((e) => [e.userId, e.rank]));

    for (const fila of tabla) {
      const previousRank = rankAnterior.get(fila.userId) ?? null;
      await prisma.rankingRankSnapshot.upsert({
        where: {
          userId_seasonNumber: { userId: fila.userId, seasonNumber: season },
        },
        create: {
          userId: fila.userId,
          seasonNumber: season,
          rank: fila.puesto,
          previousRank,
          points: fila.puntos,
        },
        update: { rank: fila.puesto, previousRank, points: fila.puntos },
      });
    }
  }
}

/**
 * Puntos del bonus de racha de HOY (aprox. su racha actual, tope 15) para
 * cada usuaria, si ya ha hecho check-in hoy. Se usa para la insignia 🔥 de
 * la tabla — barato porque reutiliza el evento que ya se guarda al puntuar.
 */
async function rachasActivasHoy(
  season: number,
  userIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (userIds.length === 0) return mapa;
  const hoy = todayInTz(now);
  const eventos = await prisma.rankingPointEvent.findMany({
    where: {
      userId: { in: userIds },
      seasonNumber: season,
      type: 'STREAK_BONUS',
      dedupeKey: `streak:${hoy}`,
    },
    select: { userId: true, points: true },
  });
  for (const e of eventos) mapa.set(e.userId, e.points);
  return mapa;
}

/** La medalla más reciente de cada usuaria (para el icono junto al nombre). */
async function medallasRecientesPara(
  userIds: string[],
): Promise<Map<string, { tier: MedalTier; seasonNumber: number }>> {
  const mapa = new Map<string, { tier: MedalTier; seasonNumber: number }>();
  if (userIds.length === 0) return mapa;
  const medallas = await prisma.seasonMedal.findMany({
    where: { userId: { in: userIds } },
    orderBy: { awardedAt: 'desc' },
    select: { userId: true, tier: true, seasonNumber: true },
  });
  for (const m of medallas) {
    if (!mapa.has(m.userId)) {
      mapa.set(m.userId, { tier: m.tier, seasonNumber: m.seasonNumber });
    }
  }
  return mapa;
}

// ─────────────────────────────────────────────────────────────────────────────
// Medallero de una participante
// ─────────────────────────────────────────────────────────────────────────────

/** Historial completo de medallas de una usuaria, más recientes primero. */
export async function medallasUsuario(targetUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { name: true, avatarUrl: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuaria no encontrada' };

  const medallas = await prisma.seasonMedal.findMany({
    where: { userId: targetUserId },
    orderBy: [{ seasonNumber: 'desc' }, { awardedAt: 'desc' }],
    select: {
      tier: true,
      seasonNumber: true,
      division: true,
      rank: true,
      streak: true,
      awardedAt: true,
    },
  });

  const resumen: Partial<Record<MedalTier, number>> = {};
  for (const m of medallas) {
    resumen[m.tier] = (resumen[m.tier] ?? 0) + 1;
  }

  return {
    ok: true as const,
    userId: targetUserId,
    nombre: user.name,
    avatarUrl: user.avatarUrl,
    medallas,
    resumen,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Desglose de puntos de una participante
// ─────────────────────────────────────────────────────────────────────────────

/** Cuánto ha aportado cada tipo de acción a la puntuación de una lectora esta temporada. */
export async function desgloseLiga(targetUserId: string, now: Date = new Date()) {
  const season = currentSeasonNumber(now);
  const participacion = await prisma.rankingParticipation.findUnique({
    where: { userId: targetUserId },
    select: { division: true },
  });
  if (!participacion) {
    return { ok: false as const, mensaje: 'Esta usuaria no participa en la liga.' };
  }
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { name: true, avatarUrl: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuaria no encontrada' };

  const [eventos, tabla] = await Promise.all([
    prisma.rankingPointEvent.groupBy({
      by: ['type'],
      where: { userId: targetUserId, seasonNumber: season },
      _sum: { points: true },
      _count: { _all: true },
    }),
    tablaTemporada(season, participacion.division),
  ]);
  const fila = tabla.find((f) => f.userId === targetUserId);

  return {
    ok: true as const,
    userId: targetUserId,
    nombre: user.name,
    avatarUrl: user.avatarUrl,
    division: participacion.division,
    puesto: fila?.puesto ?? null,
    puntos: fila?.puntos ?? 0,
    desglose: eventos
      .map((e) => ({
        tipo: e.type,
        puntos: e._sum.points ?? 0,
        eventos: e._count._all,
      }))
      .sort((a, b) => b.puntos - a.puntos),
  };
}

async function tablaTemporada(
  season: number,
  division: RankingDivision,
): Promise<FilaTabla[]> {
  const participantes = await prisma.rankingParticipation.findMany({
    where: { division },
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
  const participacion = await prisma.rankingParticipation.findUnique({
    where: { userId },
    select: { division: true },
  });

  if (!participacion) {
    return {
      ok: true as const,
      participando: false,
      temporada: { numero: season, terminaEn },
    };
  }
  const division = participacion.division;

  // Al abrir la pantalla solo se recalcula TU fila (barato y hace que tus
  // puntos se vean al instante). El resto de la tabla la refresca el job
  // `ligas:recompute` cada pocas horas — suficiente para una temporada de
  // dos semanas y no carga el servidor compartido en cada visita.
  await recalcularTemporada(userId, season).catch(() => undefined);
  await calcularRetoSemanal(userId, now).catch(() => undefined);

  const tabla = await tablaTemporada(season, division);
  const totalParticipantes = tabla.length;
  const miFila = tabla.find((f) => f.userId === userId);
  const miPuesto = miFila?.puesto ?? tabla.length + 1;
  const misPuntos = miFila?.puntos ?? 0;
  const delante = tabla.find((f) => f.puesto === miPuesto - 1) ?? null;
  const siguienteObjetivo = delante
    ? {
        nombre: delante.nombre,
        puntos: delante.puntos,
        diferencia: Math.max(1, delante.puntos - misPuntos),
      }
    : null;

  // Top 10 + ventana de ±2 alrededor de mí si estoy fuera del top + cola de
  // la tabla entera, para que se pueda ver marcada en rojo igual que el
  // ascenso se ve en el top 10 (si no, con divisiones grandes y estando a
  // mitad de tabla, nunca llegabas a ver quién desciende). En Bronce no hay
  // descenso real, pero mostramos igualmente la cola para que la tabla
  // visible siempre llegue hasta el último puesto (si no, con divisiones
  // grandes, la parte final de la tabla quedaba inalcanzable).
  const visibles = new Map<number, FilaTabla>();
  for (const f of tabla.slice(0, 10)) visibles.set(f.puesto, f);
  for (const f of tabla) {
    if (Math.abs(f.puesto - miPuesto) <= 2) visibles.set(f.puesto, f);
  }
  const { bajan } = calcularCuotaAscensoDescenso(tabla.length);
  const colaTabla = bajan > 0 ? bajan : Math.min(3, tabla.length);
  for (const f of tabla.slice(-colaTabla)) visibles.set(f.puesto, f);
  const filasBase = [...visibles.values()]
    .sort((a, b) => a.puesto - b.puesto)
    .map((f) => ({ ...f, esTu: f.userId === userId }));
  const idsVisibles = filasBase.map((f) => f.userId);

  const [tendencias, rachasHoy, medallasRecientes] = await Promise.all([
    tendenciasPara(season, idsVisibles),
    rachasActivasHoy(season, idsVisibles, now),
    medallasRecientesPara(idsVisibles),
  ]);
  const filas = filasBase.map((f) => ({
    ...f,
    ...(tendencias.get(f.userId) ?? { tendencia: null, delta: null }),
    rachaHoy: rachasHoy.get(f.userId) ?? null,
    medallaReciente: medallasRecientes.get(f.userId) ?? null,
  }));

  // Histórico permanente.
  const resultados = await prisma.rankingSeasonResult.findMany({
    where: { userId },
    select: { rank: true, totalPoints: true, division: true },
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
    mejorDivision: resultados.length
      ? resultados.reduce((best, r) =>
          ORDEN_DIVISIONES.indexOf(r.division) > ORDEN_DIVISIONES.indexOf(best)
            ? r.division
            : best,
        resultados[0].division)
      : null,
  };

  const retoSemanal = await estadoRetoSemanal(userId, now);

  return {
    ok: true as const,
    participando: true,
    temporada: {
      numero: season,
      terminaEn,
      totalParticipantes,
      division,
    },
    miPuesto,
    misPuntos,
    siguienteObjetivo,
    tabla: filas,
    historico,
    retoSemanal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de temporada (job)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A quién asciende/desciende una tabla ya cerrada: top N sube de división
 * (salvo en Diamante, techo), últimas N bajan (salvo en Bronce, suelo).
 */
export function calcularCambiosDivision(
  tabla: FilaTabla[],
  division: RankingDivision,
): Map<string, RankingDivision> {
  const cambios = new Map<string, RankingDivision>();
  const { suben, bajan } = calcularCuotaAscensoDescenso(tabla.length);
  if (suben > 0 && division !== 'DIAMANTE') {
    for (const fila of tabla.slice(0, suben)) {
      cambios.set(fila.userId, divisionSuperior(division));
    }
  }
  if (bajan > 0 && division !== 'BRONCE') {
    for (const fila of tabla.slice(-bajan)) {
      cambios.set(fila.userId, divisionInferior(division));
    }
  }
  return cambios;
}

/** Rachas de temporadas seguidas jugadas que dan medalla de constancia. */
export const HITOS_CONSTANCIA = [3, 5, 10, 20, 30];

export type MedallaAOtorgar = {
  tier: MedalTier;
  rank?: number;
  streak?: number;
};

/**
 * Qué medallas gana una fila de la tabla al cerrar su temporada — función
 * pura, sin acceso a datos, para poder testearla igual que
 * calcularCambiosDivision. `yaTieneDiamante` y `racha` se calculan aparte
 * (dependen de datos históricos) y se pasan ya resueltos.
 */
export function medallasParaFila(
  fila: Pick<FilaTabla, 'puesto' | 'userId'>,
  division: RankingDivision,
  cambios: Map<string, RankingDivision>,
  racha: number,
  yaTieneDiamante: boolean,
): MedallaAOtorgar[] {
  const medallas: MedallaAOtorgar[] = [];

  if (fila.puesto === 1) medallas.push({ tier: 'PODIO_ORO', rank: fila.puesto });
  else if (fila.puesto === 2) medallas.push({ tier: 'PODIO_PLATA', rank: fila.puesto });
  else if (fila.puesto === 3) medallas.push({ tier: 'PODIO_BRONCE', rank: fila.puesto });

  if (cambios.get(fila.userId) === divisionSuperior(division)) {
    medallas.push({ tier: 'ASCENSO', rank: fila.puesto });
  }

  if (division === 'DIAMANTE' && !yaTieneDiamante) {
    medallas.push({ tier: 'DIAMANTE' });
  }

  if (HITOS_CONSTANCIA.includes(racha)) {
    medallas.push({ tier: 'CONSTANCIA', streak: racha });
  }

  return medallas;
}

/**
 * Cuántas temporadas seguidas, terminando en `season` (incluida), tiene
 * esta usuaria un RankingSeasonResult — asume que el de `season` ya se ha
 * guardado antes de llamar a esto.
 */
async function calcularRachaTemporadas(
  userId: string,
  season: number,
): Promise<number> {
  const resultados = await prisma.rankingSeasonResult.findMany({
    where: { userId, seasonNumber: { lte: season } },
    select: { seasonNumber: true },
  });
  const temporadas = new Set(resultados.map((r) => r.seasonNumber));
  let racha = 0;
  let actual = season;
  while (temporadas.has(actual)) {
    racha += 1;
    actual -= 1;
  }
  return racha;
}

/**
 * Otorga las medallas de una división al cerrar su temporada — podio
 * (oro/plata/bronce por puesto), ascenso, Diamante (una sola vez, la
 * primera que se juega ahí) y constancia (rachas de temporadas seguidas).
 * Se llama después de guardar el RankingSeasonResult de esta temporada y
 * de calcular `cambios` (calcularCambiosDivision). Idempotente: usa upsert
 * por la clave única (userId, seasonNumber, tier).
 */
async function otorgarMedallasTemporada(
  season: number,
  division: RankingDivision,
  tabla: FilaTabla[],
  cambios: Map<string, RankingDivision>,
): Promise<void> {
  for (const fila of tabla) {
    const yaTieneDiamante =
      division === 'DIAMANTE'
        ? Boolean(
            await prisma.seasonMedal.findFirst({
              where: { userId: fila.userId, tier: 'DIAMANTE' },
              select: { id: true },
            }),
          )
        : false;
    const racha = await calcularRachaTemporadas(fila.userId, season);
    const medallas = medallasParaFila(fila, division, cambios, racha, yaTieneDiamante);

    for (const medalla of medallas) {
      await prisma.seasonMedal.upsert({
        where: {
          userId_seasonNumber_tier: {
            userId: fila.userId,
            seasonNumber: season,
            tier: medalla.tier,
          },
        },
        create: {
          userId: fila.userId,
          seasonNumber: season,
          division,
          tier: medalla.tier,
          rank: medalla.rank ?? null,
          streak: medalla.streak ?? null,
        },
        update: {},
      });
    }
  }
}

/**
 * Recalcula, ordena y congela el resultado de una temporada — por
 * división, cada una compite solo contra sí misma. Aplica ascensos y
 * descensos para la temporada siguiente. Idempotente.
 */
export async function cerrarTemporada(season: number): Promise<number> {
  const participantes = await prisma.rankingParticipation.findMany({
    select: { userId: true },
  });
  for (const { userId } of participantes) {
    await recalcularTemporada(userId, season).catch(() => undefined);
  }

  let totalCerrados = 0;
  for (const division of await divisionesEnUso()) {
    const tabla = await tablaTemporada(season, division);
    if (tabla.length === 0) continue;
    totalCerrados += tabla.length;

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
          division,
        },
        update: { totalPoints: fila.puntos, rank: fila.puesto, division },
      });
    }

    const cambios = calcularCambiosDivision(tabla, division);
    for (const [userId, nuevaDivision] of cambios) {
      await prisma.rankingParticipation
        .update({ where: { userId }, data: { division: nuevaDivision } })
        .catch(() => undefined);
    }

    try {
      await otorgarMedallasTemporada(season, division, tabla, cambios);
    } catch (error) {
      console.error('Ligas: no se pudieron otorgar las medallas:', error);
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
          division,
          nuevaDivision: cambios.get(f.userId) ?? null,
        })),
      );
    } catch (error) {
      console.error('Ligas: no se pudo notificar el resultado:', error);
    }
  }

  return totalCerrados;
}

/**
 * Aviso de cierre inminente: cuando falten <=24 h para el fin de la
 * temporada en curso, avisa una sola vez a cada participante (dentro de su
 * división) de su posición y de a cuántos puntos está el podio. Idempotente.
 */
export async function avisarCierreProximo(
  season: number,
  now: Date = new Date(),
): Promise<number> {
  const msRestantes = seasonEndsAt(season).getTime() - now.getTime();
  const horasRestantes = msRestantes / 3_600_000;
  if (horasRestantes <= 0 || horasRestantes > 24) return 0;

  let totalAvisados = 0;
  for (const division of await divisionesEnUso()) {
    const tabla = await tablaTemporada(season, division);
    if (tabla.length === 0) continue;
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
    totalAvisados += entradas.length;
  }
  return totalAvisados;
}

/** ¿Ya se cerró esta temporada? (existe al menos un snapshot). */
export async function temporadaCerrada(season: number): Promise<boolean> {
  const n = await prisma.rankingSeasonResult.count({
    where: { seasonNumber: season },
  });
  return n > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reto semanal
// ─────────────────────────────────────────────────────────────────────────────
//
// Independiente de las temporadas de 14 días: semanas de lunes a domingo
// (Europe/Madrid). Reto fijo de partida: check-in 5 de los 7 días de la
// semana. El bonus se calcula igual que el resto de eventos (dedupeKey
// determinista) y aterriza en la temporada en la que cae "hoy" — se
// recalcula en cada ciclo del cron y al abrir la pantalla, así que se
// autocorrige si un check-in se revierte.

export const RETO_SEMANAL_DIAS_OBJETIVO = 5;
export const RETO_SEMANAL_PUNTOS = 30;

/** Lunes (inicio, incluido) y el lunes siguiente (fin, excluido) de la semana de `dia`. */
export function semanaDe(dia: string): { inicio: string; fin: string } {
  const [y, m, d] = dia.split('-').map(Number);
  const diaSemana = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  const offsetALunes = (diaSemana + 6) % 7;
  const inicio = addDaysStr(dia, -offsetALunes);
  return { inicio, fin: addDaysStr(inicio, 7) };
}

async function diasConCheckinEnSemana(userId: string, dia: string): Promise<number> {
  const { inicio, fin } = semanaDe(dia);
  return prisma.dailyCheckin.count({
    where: { userId, date: { gte: inicio, lt: fin } },
  });
}

/**
 * Recalcula (idempotente) el bonus del reto semanal de esta usuaria para la
 * semana de "hoy". Se llama desde `getLiga` (tu propia fila, al instante) y
 * desde el cron (todo el mundo).
 */
export async function calcularRetoSemanal(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const hoy = todayInTz(now);
  const season = currentSeasonNumber(now);
  if (!(await esParticipante(userId))) return;

  const dias = await diasConCheckinEnSemana(userId, hoy);
  const { inicio } = semanaDe(hoy);
  const dedupeKey = `weekly:${inicio}`;
  const cumplido = dias >= RETO_SEMANAL_DIAS_OBJETIVO;

  if (cumplido) {
    await prisma.rankingPointEvent.upsert({
      where: { userId_seasonNumber_dedupeKey: { userId, seasonNumber: season, dedupeKey } },
      create: {
        userId,
        seasonNumber: season,
        type: 'WEEKLY_CHALLENGE',
        points: RETO_SEMANAL_PUNTOS,
        dedupeKey,
      },
      update: {},
    });
  } else {
    await prisma.rankingPointEvent
      .deleteMany({ where: { userId, seasonNumber: season, dedupeKey } })
      .catch(() => undefined);
  }
}

/** Tu progreso del reto semanal, para mostrar una barrita en la pantalla. */
export async function estadoRetoSemanal(userId: string, now: Date = new Date()) {
  const hoy = todayInTz(now);
  const dias = await diasConCheckinEnSemana(userId, hoy);
  return {
    objetivo: RETO_SEMANAL_DIAS_OBJETIVO,
    progreso: Math.min(dias, RETO_SEMANAL_DIAS_OBJETIVO),
    puntos: RETO_SEMANAL_PUNTOS,
    completado: dias >= RETO_SEMANAL_DIAS_OBJETIVO,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aviso de racha en riesgo
// ─────────────────────────────────────────────────────────────────────────────

const RACHA_EN_RIESGO_HORA_DESDE = 20; // 20:00 Madrid
const RACHA_EN_RIESGO_HORA_HASTA = 23; // hasta las 23:00 Madrid
const RACHA_EN_RIESGO_DIAS_MINIMOS = 3; // no molestamos por una racha de 1-2 días

/**
 * Por la tarde-noche (hora de Madrid), avisa a quien tiene una racha larga
 * en marcha y todavía no ha hecho check-in hoy, para que no se le rompa sin
 * darse cuenta. Como máximo un aviso por persona y día. Fuera de esa franja
 * horaria no hace nada — se puede llamar en cada ciclo del cron sin miedo.
 */
export async function avisarRachaEnRiesgo(now: Date = new Date()): Promise<number> {
  const horaMadrid = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  if (horaMadrid < RACHA_EN_RIESGO_HORA_DESDE || horaMadrid >= RACHA_EN_RIESGO_HORA_HASTA) {
    return 0;
  }

  const hoy = todayInTz(now);
  const ayer = addDaysStr(hoy, -1);

  const participantes = await prisma.rankingParticipation.findMany({
    select: { userId: true },
  });

  let avisados = 0;
  for (const { userId } of participantes) {
    const [hoyMarcado, ayerMarcado, yaAvisado] = await Promise.all([
      prisma.dailyCheckin.findUnique({ where: { userId_date: { userId, date: hoy } } }),
      prisma.dailyCheckin.findUnique({ where: { userId_date: { userId, date: ayer } } }),
      yaAvisadoRachaHoy(userId, hoy),
    ]);
    if (hoyMarcado || !ayerMarcado || yaAvisado) continue;

    const dias = await longitudRachaEnDb(userId, ayer);
    if (dias < RACHA_EN_RIESGO_DIAS_MINIMOS) continue;

    try {
      await notifyLigaRachaEnRiesgo(userId, dias, hoy);
      avisados += 1;
    } catch (error) {
      console.error(`Ligas: no se pudo avisar de racha en riesgo a ${userId}:`, error);
    }
  }
  return avisados;
}
