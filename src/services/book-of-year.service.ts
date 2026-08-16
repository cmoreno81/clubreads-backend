import { BookOfYearDuelPhase, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

const MADRID = 'Europe/Madrid';
const bookInclude = { author: { select: { name: true } } } as const;

type Db = Prisma.TransactionClient;

export class BookOfYearError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function madridCalendar(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function madridOffsetMs(date: Date) {
  const name = new Intl.DateTimeFormat('en', {
    timeZone: MADRID, timeZoneName: 'longOffset',
  }).formatToParts(date).find(({ type }) => type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -minutes : minutes) * 60_000;
}

export function madridMonthBounds(year: number, month: number) {
  const startGuess = new Date(Date.UTC(year, month - 1, 1));
  const nextGuess = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  return {
    start: new Date(startGuess.getTime() - madridOffsetMs(startGuess)),
    end: new Date(nextGuess.getTime() - madridOffsetMs(nextGuess)),
  };
}

function validateYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new BookOfYearError('INVALID_YEAR', 'Año no válido');
}

function serializeBook(book: { id: string; title: string; coverUrl: string | null; author?: { name: string } | null }) {
  return { id: book.id, title: book.title, coverUrl: book.coverUrl ?? '', authorName: book.author?.name ?? '' };
}

function monthFinished(year: number, month: number, now: Date) {
  const current = madridCalendar(now);
  return year < current.year || (year === current.year && month < current.month);
}

export function resolveDuelWinner(previous: string | undefined, candidates: Array<string | undefined>) {
  const available = [...new Set(candidates.filter((id): id is string => Boolean(id)))];
  if (previous && available.includes(previous)) return { bookId: previous, automatic: false };
  return { bookId: undefined, automatic: false };
}

async function eligibleBooks(db: Db | typeof prisma, userId: string, year: number) {
  const { start } = madridMonthBounds(year, 1);
  const { end } = madridMonthBounds(year, 12);
  const completions = await db.readingCompletion.findMany({
    where: { userId, finishedAt: { gte: start, lt: end } },
    orderBy: { finishedAt: 'asc' },
    include: { book: { include: bookInclude } },
  });
  const byMonth = new Map<number, Map<string, ReturnType<typeof serializeBook>>>();
  for (const completion of completions) {
    const month = madridCalendar(completion.finishedAt).month;
    const books = byMonth.get(month) ?? new Map();
    books.set(completion.bookId, serializeBook(completion.book));
    byMonth.set(month, books);
  }
  return byMonth;
}

async function syncBracket(tx: Db, userId: string, year: number, now: Date) {
  await tx.bookOfYearDuelWinner.deleteMany({
    where: { userId, year, automatic: true },
  });
  const selections = await tx.bookOfYearMonthlySelection.findMany({ where: { userId, year } });
  const selected = new Map(selections.map((item) => [item.month, item.bookId]));
  const syncPhase = async (phase: BookOfYearDuelPhase, pairs: Array<Array<string | undefined>>) => {
    const existing = await tx.bookOfYearDuelWinner.findMany({
      where: { userId, year, phase, automatic: false },
    });
    const result = new Map<number, string>();
    for (let index = 0; index < pairs.length; index++) {
      const position = index + 1;
      const previous = existing.find((item) => item.position === position);
      const resolved = resolveDuelWinner(previous?.bookId, pairs[index]!);
      if (!resolved.bookId) {
        await tx.bookOfYearDuelWinner.deleteMany({ where: { userId, year, phase, position } });
      } else {
        result.set(position, resolved.bookId);
      }
    }
    return result;
  };

  const firstPairs = Array.from({ length: 6 }, (_, i) =>
    monthFinished(year, (i + 1) * 2, now)
      ? [selected.get(i * 2 + 1), selected.get(i * 2 + 2)]
      : [],
  );
  const first = await syncPhase(BookOfYearDuelPhase.MONTH_PAIR, firstPairs);
  const semifinalPairs = Array.from({ length: 3 }, (_, i) => [first.get(i * 2 + 1), first.get(i * 2 + 2)]);
  const semifinals = await syncPhase(BookOfYearDuelPhase.SEMIFINAL, semifinalPairs);

  for (let position = 1; position <= 3; position++) {
    const bookId = semifinals.get(position);
    if (bookId) {
      await tx.bookOfYearFinalist.upsert({
        where: { userId_year_position: { userId, year, position } },
        create: { userId, year, position, bookId }, update: { bookId },
      });
    } else await tx.bookOfYearFinalist.deleteMany({ where: { userId, year, position } });
  }
  const finalistIds = new Set(semifinals.values());
  const annual = await tx.bookOfYearWinner.findUnique({ where: { userId_year: { userId, year } } });
  if (annual && !finalistIds.has(annual.bookId)) await tx.bookOfYearWinner.delete({ where: { id: annual.id } });
}

async function boardForUser(userId: string, year: number, editable: boolean, now = new Date()) {
  validateYear(year);
  const [user, eligible, selections, duels, finalists, winner] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, avatarUrl: true } }),
    eligibleBooks(prisma, userId, year),
    prisma.bookOfYearMonthlySelection.findMany({ where: { userId, year }, include: { book: { include: bookInclude } } }),
    prisma.bookOfYearDuelWinner.findMany({ where: { userId, year, automatic: false }, include: { book: { include: bookInclude } }, orderBy: [{ phase: 'asc' }, { position: 'asc' }] }),
    prisma.bookOfYearFinalist.findMany({ where: { userId, year }, include: { book: { include: bookInclude } }, orderBy: { position: 'asc' } }),
    prisma.bookOfYearWinner.findUnique({ where: { userId_year: { userId, year } }, include: { book: { include: bookInclude } } }),
  ]);
  if (!user) throw new BookOfYearError('USER_NOT_FOUND', 'Usuaria no encontrada');
  const current = madridCalendar(now);
  const selectionByMonth = new Map(selections.map((item) => [item.month, item]));
  const duelByKey = new Map(duels.map((item) => [`${item.phase}:${item.position}`, item]));
  const firstWinner = (position: number) => duelByKey.get(`${BookOfYearDuelPhase.MONTH_PAIR}:${position}`);
  const validFinalistIds = new Set(
    duels
      .filter((item) => item.phase === BookOfYearDuelPhase.SEMIFINAL)
      .map((item) => item.bookId),
  );
  const allDuels = [
    ...Array.from({ length: 6 }, (_, i) => {
      const position = i + 1;
      const winner = duelByKey.get(`${BookOfYearDuelPhase.MONTH_PAIR}:${position}`);
      return { phase: BookOfYearDuelPhase.MONTH_PAIR, position, automatic: winner?.automatic ?? false, unlocked: monthFinished(year, position * 2, now), candidates: [selectionByMonth.get(position * 2 - 1), selectionByMonth.get(position * 2)].filter((item) => item != null).map((item) => serializeBook(item.book)), winner: winner ? serializeBook(winner.book) : null };
    }),
    ...Array.from({ length: 3 }, (_, i) => {
      const position = i + 1;
      const winner = duelByKey.get(`${BookOfYearDuelPhase.SEMIFINAL}:${position}`);
      return { phase: BookOfYearDuelPhase.SEMIFINAL, position, automatic: false, unlocked: Boolean(firstWinner(position * 2 - 1) && firstWinner(position * 2)), candidates: [firstWinner(position * 2 - 1), firstWinner(position * 2)].filter((item) => item != null).map((item) => serializeBook(item.book)), winner: winner ? serializeBook(winner.book) : null };
    }),
  ];
  return {
    ok: true, year, editable, usuario: { id: user.id, nombre: user.name, avatarUrl: user.avatarUrl ?? '' },
    hasSelections: selections.length > 0,
    months: Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const locked = year > current.year || (year === current.year && month > current.month);
      const selection = selectionByMonth.get(month);
      return { month, locked, finished: monthFinished(year, month, now), eligible: [...(eligible.get(month)?.values() ?? [])], selection: selection ? serializeBook(selection.book) : null };
    }),
    duels: allDuels,
    finalists: finalists.filter((item) => validFinalistIds.has(item.bookId)).map((item) => ({ position: item.position, book: serializeBook(item.book) })),
    winner: winner && validFinalistIds.has(winner.bookId) ? serializeBook(winner.book) : null,
  };
}

export async function getMyBookOfYear(userId: string, year: number, now = new Date()) {
  return boardForUser(userId, year, true, now);
}

export async function saveMonthlyBookOfYear(userId: string, year: number, month: number, bookId: string, now = new Date()) {
  validateYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new BookOfYearError('INVALID_MONTH', 'Mes no válido');
  const current = madridCalendar(now);
  if (year > current.year || (year === current.year && month > current.month)) throw new BookOfYearError('MONTH_LOCKED', 'Ese mes todavía está bloqueado');
  const { start, end } = madridMonthBounds(year, month);
  const completion = await prisma.readingCompletion.findFirst({ where: { userId, bookId, finishedAt: { gte: start, lt: end } } });
  if (!completion) throw new BookOfYearError('BOOK_NOT_ELIGIBLE', 'El libro no fue terminado en ese mes');
  await prisma.$transaction(async (tx) => {
    await tx.bookOfYearMonthlySelection.upsert({ where: { userId_year_month: { userId, year, month } }, create: { userId, year, month, bookId }, update: { bookId } });
    await syncBracket(tx, userId, year, now);
  });
  return getMyBookOfYear(userId, year, now);
}

export async function chooseBookOfYearDuel(userId: string, year: number, phase: BookOfYearDuelPhase, position: number, bookId: string, now = new Date()) {
  validateYear(year);
  const max = phase === BookOfYearDuelPhase.MONTH_PAIR ? 6 : 3;
  if (!Number.isInteger(position) || position < 1 || position > max) throw new BookOfYearError('INVALID_POSITION', 'Duelo no válido');
  await prisma.$transaction(async (tx) => {
    await syncBracket(tx, userId, year, now);
    const candidates = phase === BookOfYearDuelPhase.MONTH_PAIR
      ? await tx.bookOfYearMonthlySelection.findMany({ where: { userId, year, month: { in: [position * 2 - 1, position * 2] } } })
      : await tx.bookOfYearDuelWinner.findMany({ where: { userId, year, phase: BookOfYearDuelPhase.MONTH_PAIR, position: { in: [position * 2 - 1, position * 2] } } });
    if (phase === BookOfYearDuelPhase.MONTH_PAIR && !monthFinished(year, position * 2, now)) throw new BookOfYearError('DUEL_LOCKED', 'El duelo todavía está bloqueado');
    if (!candidates.some((item) => item.bookId === bookId)) throw new BookOfYearError('INVALID_CANDIDATE', 'El libro no pertenece a este duelo');
    await tx.bookOfYearDuelWinner.upsert({ where: { userId_year_phase_position: { userId, year, phase, position } }, create: { userId, year, phase, position, bookId, automatic: false }, update: { bookId, automatic: false } });
    await syncBracket(tx, userId, year, now);
  });
  return getMyBookOfYear(userId, year, now);
}

export async function chooseAnnualBookOfYear(userId: string, year: number, bookId: string, now = new Date()) {
  if (!monthFinished(year, 12, now)) throw new BookOfYearError('FINAL_LOCKED', 'La final se desbloquea al terminar diciembre');
  await prisma.$transaction(async (tx) => {
    await syncBracket(tx, userId, year, now);
    const finalist = await tx.bookOfYearFinalist.findFirst({ where: { userId, year, bookId } });
    if (!finalist) throw new BookOfYearError('INVALID_FINALIST', 'El libro no es finalista');
    await tx.bookOfYearWinner.upsert({ where: { userId_year: { userId, year } }, create: { userId, year, bookId }, update: { bookId } });
  });
  return getMyBookOfYear(userId, year, now);
}

async function assertSharedVisibleClub(requesterId: string, targetId: string) {
  if (requesterId === targetId) return;
  const shared = await prisma.clubMember.findFirst({
    where: { userId: requesterId, club: { tipo: 'SOCIAL', members: { some: { userId: targetId } } } }, select: { clubId: true },
  });
  if (!shared) throw new BookOfYearError('FORBIDDEN', 'No compartís un club visible');
}

export async function getPublicBookOfYear(
  requesterId: string,
  profile: string,
  year: number,
  now = new Date(),
  profileId?: string,
) {
  // Prefer stable ID lookup; fall back to name search.
  const target = profileId?.trim()
    ? await prisma.user.findUnique({ where: { id: profileId.trim() }, select: { id: true } })
    : await prisma.user.findFirst({ where: { name: profile.trim() }, select: { id: true } });
  if (!target) throw new BookOfYearError('USER_NOT_FOUND', 'Usuaria no encontrada');
  await assertSharedVisibleClub(requesterId, target.id);
  return boardForUser(target.id, year, false, now);
}

export async function getClubBooksOfYear(userId: string, year: number, now = new Date()) {
  validateYear(year);
  const memberships = await prisma.clubMember.findMany({ where: { userId, club: { tipo: 'SOCIAL' } }, select: { clubId: true } });
  const users = await prisma.user.findMany({
    where: { clubMemberships: { some: { clubId: { in: memberships.map(({ clubId }) => clubId) } } }, bookOfYearMonthlySelections: { some: { year } } },
    select: { id: true, name: true, avatarUrl: true, bookOfYearMonthlySelections: { where: { year }, orderBy: { month: 'asc' }, include: { book: { include: bookInclude } } }, bookOfYearFinalists: { where: { year }, include: { book: { include: bookInclude } } }, bookOfYearWinners: { where: { year }, include: { book: { include: bookInclude } } } },
  });
  return { ok: true, year, miembros: users.map((user) => ({ usuario: user.name, avatarUrl: user.avatarUrl ?? '', completedMonths: user.bookOfYearMonthlySelections.length, selections: user.bookOfYearMonthlySelections.map((item) => ({ month: item.month, book: serializeBook(item.book) })), finalists: user.bookOfYearFinalists.map((item) => serializeBook(item.book)), winner: user.bookOfYearWinners[0] ? serializeBook(user.bookOfYearWinners[0].book) : null })) };
}
