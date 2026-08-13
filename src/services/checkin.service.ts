/**
 * Servicio de check-in lector diario, mapa de calor anual y Wrapped anual.
 */

import { prisma } from '../prisma.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function yearStart(year: number): Date {
  return new Date(`${year}-01-01T00:00:00.000Z`);
}

function yearEnd(year: number): Date {
  return new Date(`${year + 1}-01-01T00:00:00.000Z`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Check-in
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra el check-in del día de hoy (idempotente).
 * Devuelve el check-in y la racha actual.
 */
export async function doCheckIn(userId: string, note?: string) {
  const today = todayString();

  const checkin = await prisma.dailyCheckin.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, note: note?.trim() || null },
    update: { note: note?.trim() ?? undefined },
  });

  const streak = await getStreak(userId);

  return { ok: true, date: today, checkin, streak };
}

/**
 * Devuelve los check-ins de los últimos N días.
 */
export async function getCheckinHistory(userId: string, days = 365) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const checkins = await prisma.dailyCheckin.findMany({
    where: { userId, date: { gte: sinceStr } },
    orderBy: { date: 'asc' },
    select: { date: true },
  });

  const streak = await getStreak(userId);
  const today = todayString();
  const checkedToday = checkins.some((c) => c.date === today);

  return {
    ok: true,
    checkins: checkins.map((c) => c.date),
    streak,
    checkedToday,
  };
}

/**
 * Calcula la racha actual de días consecutivos con check-in.
 */
async function getStreak(userId: string): Promise<number> {
  // Traemos los últimos 400 días para cubrir rachas largas
  const since = new Date();
  since.setDate(since.getDate() - 400);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = await prisma.dailyCheckin.findMany({
    where: { userId, date: { gte: sinceStr } },
    orderBy: { date: 'desc' },
    select: { date: true },
  });

  const dates = new Set(rows.map((r) => r.date));
  const today = todayString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // La racha empieza desde hoy (o desde ayer si hoy aún no hay check-in)
  const startFrom = dates.has(today) ? today : dates.has(yesterdayStr) ? yesterdayStr : null;
  if (!startFrom) return 0;

  let streak = 0;
  const cursor = new Date(startFrom);

  while (true) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!dates.has(dateStr)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de calor anual
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve todos los días con actividad lectora del año indicado.
 * Combina: check-ins explícitos + días con progreso actualizado + días con libro terminado.
 * Para cada fecha devuelve el nivel de intensidad (1-4).
 */
export async function getHeatmap(userId: string, year: number) {
  const start = yearStart(year);
  const end = yearEnd(year);
  const startStr = `${year}-01-01`;
  const endStr = `${year}-12-31`;

  // 1. Sesiones de lectura con páginas reales (señal principal de intensidad)
  // Wrapped en try-catch por si la migración aún no se ha aplicado en este entorno
  let sessions: { date: string; pagesRead: number }[] = [];
  try {
    sessions = await prisma.readingSession.findMany({
      where: { userId, date: { gte: startStr, lte: endStr } },
      select: { date: true, pagesRead: true },
    });
  } catch {
    // Tabla ReadingSession no existe todavía — se usa sin ella (fallback a check-ins)
    sessions = [];
  }

  // 2. Check-ins explícitos (fallback cuando no se actualizó progreso)
  const checkins = await prisma.dailyCheckin.findMany({
    where: { userId, date: { gte: startStr, lte: endStr } },
    select: { date: true },
  });

  // 3. Días con progreso actualizado (fallback cuando la sesión no registró páginas)
  const progressDays = await prisma.library.findMany({
    where: {
      userId,
      progressUpdatedAt: { gte: start, lt: end },
    },
    select: { progressUpdatedAt: true },
  });

  // 4. Libros terminados (siempre suma +1 al nivel del día)
  const completionDays = await prisma.readingCompletion.findMany({
    where: { userId, finishedAt: { gte: start, lt: end } },
    select: { finishedAt: true },
  });

  // ── Construir mapa de intensidad ──────────────────────────────────────────
  // Nivel basado en páginas leídas ese día:
  //   ≥ 80 páginas → 4  |  40-79 → 3  |  16-39 → 2  |  1-15 → 1
  // Si no hay datos de páginas pero hubo check-in o progreso → nivel 1
  // Terminar un libro sube el nivel en +1 (máximo 4)

  const levelMap = new Map<string, number>();

  // Sesiones con páginas reales → determinan la intensidad base
  for (const s of sessions) {
    const level = s.pagesRead >= 80 ? 4 : s.pagesRead >= 40 ? 3 : s.pagesRead >= 16 ? 2 : 1;
    const current = levelMap.get(s.date) ?? 0;
    levelMap.set(s.date, Math.max(current, level));
  }

  // Check-ins: garantizan al menos nivel 1 si no hay sesión con páginas
  for (const c of checkins) {
    if (!levelMap.has(c.date)) {
      levelMap.set(c.date, 1);
    }
  }

  // Actualizaciones de progreso (sin páginas conocidas): al menos nivel 1
  for (const p of progressDays) {
    if (p.progressUpdatedAt) {
      const date = p.progressUpdatedAt.toISOString().slice(0, 10);
      if (!levelMap.has(date)) {
        levelMap.set(date, 1);
      }
    }
  }

  // Libros terminados: sube el nivel en +1 (hasta 4); garantiza al menos nivel 1
  for (const c of completionDays) {
    const date = c.finishedAt.toISOString().slice(0, 10);
    const current = levelMap.get(date) ?? 0;
    levelMap.set(date, Math.min(4, current + 1));
  }

  const days: { date: string; level: number }[] = [];
  for (const [date, level] of levelMap.entries()) {
    days.push({ date, level });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const streak = await getStreak(userId);
  const totalActiveDays = days.length;

  return { ok: true, year, days, totalActiveDays, streak };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapped anual
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera el resumen "Wrapped" del año para un usuario.
 */
export async function getWrapped(userId: string, year: number) {
  const start = yearStart(year);
  const end = yearEnd(year);

  // Libros terminados este año
  const completions = await prisma.readingCompletion.findMany({
    where: { userId, finishedAt: { gte: start, lt: end } },
    include: { book: { include: { author: true, genre: true } } },
    orderBy: { finishedAt: 'asc' },
  });

  // Días activos (heatmap básico)
  const heatmap = await getHeatmap(userId, year);

  // Estadísticas de libros
  const totalBooks = completions.length;
  const totalPages = completions.reduce(
    (sum, c) => sum + (c.book.totalPages ?? 0),
    0,
  );

  // Género más leído
  const genreCounts = new Map<string, { name: string; count: number }>();
  for (const c of completions) {
    const genre = c.book.genre.name;
    const existing = genreCounts.get(genre) ?? { name: genre, count: 0 };
    existing.count += 1;
    genreCounts.set(genre, existing);
  }
  const topGenre = [...genreCounts.values()].sort((a, b) => b.count - a.count)[0] ?? null;
  const genres = [...genreCounts.values()].sort((a, b) => b.count - a.count);

  // Autor más leído
  const authorCounts = new Map<string, { name: string; count: number }>();
  for (const c of completions) {
    const author = c.book.author?.name ?? 'Desconocido';
    const existing = authorCounts.get(author) ?? { name: author, count: 0 };
    existing.count += 1;
    authorCounts.set(author, existing);
  }
  const topAuthor = [...authorCounts.values()].sort((a, b) => b.count - a.count)[0] ?? null;

  // Mejor mes (más libros terminados)
  const byMonth = new Array(12).fill(0);
  for (const c of completions) {
    const month = new Date(c.finishedAt).getUTCMonth(); // 0-11
    byMonth[month] += 1;
  }
  const bestMonthIdx = byMonth.indexOf(Math.max(...byMonth));
  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];

  // Rating medio
  const rated = completions.filter((c) => c.rating != null);
  const avgRating = rated.length > 0
    ? rated.reduce((sum, c) => sum + (c.rating ?? 0), 0) / rated.length
    : null;

  // Libro más largo
  const longestBook = completions
    .filter((c) => c.book.totalPages)
    .sort((a, b) => (b.book.totalPages ?? 0) - (a.book.totalPages ?? 0))[0]?.book ?? null;

  // Primer libro del año
  const firstBook = completions[0]?.book ?? null;

  // Comparativa con año anterior
  const prevStart = yearStart(year - 1);
  const prevEnd = yearEnd(year - 1);
  const prevCompletions = await prisma.readingCompletion.count({
    where: { userId, finishedAt: { gte: prevStart, lt: prevEnd } },
  });
  const diffVsPrevYear = totalBooks - prevCompletions;

  return {
    ok: true,
    year,
    totalBooks,
    totalPages,
    totalActiveDays: heatmap.totalActiveDays,
    streak: heatmap.streak,
    topGenre,
    genres,
    topAuthor,
    byMonth,
    bestMonth: byMonth[bestMonthIdx] > 0
      ? { month: bestMonthIdx + 1, name: monthNames[bestMonthIdx], count: byMonth[bestMonthIdx] }
      : null,
    avgRating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
    longestBook: longestBook
      ? { title: longestBook.title, pages: longestBook.totalPages, coverUrl: longestBook.coverUrl }
      : null,
    firstBook: firstBook
      ? { title: firstBook.title, coverUrl: firstBook.coverUrl }
      : null,
    diffVsPrevYear,
    prevYearBooks: prevCompletions,
    // Lista de todos los libros terminados (para la estantería visual)
    books: completions.map((c) => ({
      title: c.book.title,
      coverUrl: c.book.coverUrl ?? null,
    })),
  };
}
