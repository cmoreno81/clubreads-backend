import {
  ClubBookOfYearPhase,
  ClubBookOfYearRoundStatus,
  ClubBookOfYearStatus,
  ClubRole,
  ClubType,
  ReadingSessionStatus,
  ReadingType,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { requireClubMember, requireClubRole } from './club-context.service.js';
import { notifyClubBookOfYear } from './notifications.service.js';
import { enrichClubvisionHistoryRows } from './clubvision.service.js';

export class ClubBookOfYearError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
  }
}

const adminRoles: ClubRole[] = [ClubRole.OWNER, ClubRole.ADMIN];

async function requireSocialClubMember(usuario: string) {
  const context = await requireClubMember(usuario);
  if (context.club.tipo !== ClubType.SOCIAL) {
    throw new ClubBookOfYearError(
      'SOCIAL_CLUB_REQUIRED',
      'Libro del año del club solo está disponible en clubes sociales',
      403,
    );
  }
  return context;
}

async function requireSocialClubAdmin(usuario: string) {
  const context = await requireClubRole(usuario, adminRoles);
  if (context.club.tipo !== ClubType.SOCIAL) {
    throw new ClubBookOfYearError(
      'SOCIAL_CLUB_REQUIRED',
      'Libro del año del club solo está disponible en clubes sociales',
      403,
    );
  }
  return context;
}
const yearRange = (year: number) => ({
  gte: new Date(`${year}-01-01T00:00:00.000Z`),
  lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
});
export const clubBookOfYearBracketSize = (count: number) => count === 3 ? 2 : count >= 5 && count <= 7 ? 4 : count > 8 ? 8 : count;
const needsQualifying = (count: number) => ![2, 4, 8].includes(count);
const firstPhase = (size: number) => size === 8 ? ClubBookOfYearPhase.QUARTERFINAL : size === 4 ? ClubBookOfYearPhase.SEMIFINAL : ClubBookOfYearPhase.FINAL;

type PreparedCandidate = {
  bookId: string;
  book: { id: string; title: string; coverUrl: string | null; author: { name: string } | null };
  source: 'CLUBVISION' | 'OFFICIAL_READING';
  clubvisionEdition: string | null;
  sortKey: string;
};

type UnresolvedCandidate = { resultId: string; title: string; edition: string };

async function eligible(clubId: string, year: number, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const [results, readings] = await Promise.all([
    tx.clubvisionResult.findMany({
      where: { clubId, edition: { startsWith: `${year}-` } },
      orderBy: [{ edition: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        edition: true,
        winnerTitle: true,
        winnerBookId: true,
        winnerBook: { select: { id: true, coverUrl: true } },
        points: true,
        secondTitle: true,
        thirdTitle: true,
      },
    }),
    tx.reading.findMany({
    where: { clubId, type: ReadingType.CLUBVISION, status: ReadingSessionStatus.FINISHED, finishedAt: yearRange(year) },
    orderBy: [{ finishedAt: 'asc' }, { bookId: 'asc' }],
    include: { book: { include: { author: true } } },
    }),
  ]);

  const validResults = results.filter((result) => /^\d{4}-(0[1-9]|1[0-2])$/.test(result.edition));
  const links = validResults.length === 0 ? [] : await tx.clubBookOfYearHistoricalLink.findMany({
    where: { clubId, year, resultId: { in: validResults.map((result) => result.id) } },
    select: { resultId: true, bookId: true },
  });
  const linkedByResult = new Map(links.map((link) => [link.resultId, link.bookId]));
  const rowsForResolution = validResults.map((result) => {
    const linkedBookId = linkedByResult.get(result.id);
    return linkedBookId
      ? { ...result, winnerBookId: linkedBookId, winnerBook: { id: linkedBookId, coverUrl: null } }
      : result;
  });
  const enriched = await enrichClubvisionHistoryRows(rowsForResolution, tx);
  const resolvedIds = enriched.map((row) => row.ganadoraBookId).filter(Boolean);
  const resultBooks = resolvedIds.length === 0 ? [] : await tx.book.findMany({
    where: { id: { in: resolvedIds } },
    include: { author: true },
  });
  const booksById = new Map(resultBooks.map((book) => [book.id, book]));
  const unique = new Map<string, PreparedCandidate>();
  const unresolvedCandidates: UnresolvedCandidate[] = [];

  validResults.forEach((result, index) => {
    const bookId = enriched[index]?.ganadoraBookId ?? '';
    const book = booksById.get(bookId);
    if (!book) {
      unresolvedCandidates.push({ resultId: result.id, title: result.winnerTitle, edition: result.edition });
      return;
    }
    unique.set(book.id, {
      bookId: book.id,
      book,
      source: 'CLUBVISION',
      clubvisionEdition: result.edition,
      sortKey: `${result.edition}-00`,
    });
  });

  for (const reading of readings) {
    if (unique.has(reading.bookId)) continue;
    unique.set(reading.bookId, {
      bookId: reading.bookId,
      book: reading.book,
      source: 'OFFICIAL_READING',
      clubvisionEdition: null,
      sortKey: reading.finishedAt?.toISOString() ?? `${year}-12-31`,
    });
  }

  return {
    candidates: [...unique.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.bookId.localeCompare(b.bookId)),
    unresolvedCandidates,
  };
}

const candidateBook = (candidate: any) => ({
  candidateId: candidate.id,
  bookId: candidate.bookId,
  title: candidate.titleSnapshot,
  coverUrl: candidate.coverUrlSnapshot ?? '',
  authorName: candidate.authorNameSnapshot ?? '',
  seed: candidate.seed,
});

async function loadEdition(clubId: string, year: number, userId: string) {
  const edition = await prisma.clubBookOfYearEdition.findUnique({
    where: { clubId_year: { clubId, year } },
    include: {
      club: { select: { name: true } },
      winnerCandidate: true,
      candidates: { orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }] },
      qualifyingVotes: { where: { userId }, select: { candidateId: true } },
      rounds: {
        orderBy: { sequence: 'asc' },
        include: {
          duels: {
            orderBy: { position: 'asc' },
            include: {
              candidateA: true,
              candidateB: true,
              winnerCandidate: true,
              votes: { where: { userId }, select: { candidateId: true } },
            },
          },
        },
      },
    },
  });
  return edition;
}

function serialize(edition: Awaited<ReturnType<typeof loadEdition>>, canAdmin: boolean) {
  if (!edition) return null;
  return {
    id: edition.id,
    clubId: edition.clubId,
    clubName: edition.club.name,
    year: edition.year,
    status: edition.status,
    canAdmin,
    candidates: edition.candidates.filter((candidate) => edition.status !== ClubBookOfYearStatus.TIEBREAK || candidate.tiebreakEligible).map(candidateBook),
    myQualifyingVotes: edition.qualifyingVotes.map((vote) => vote.candidateId),
    rounds: edition.rounds.map((round) => ({
      id: round.id,
      phase: round.phase,
      sequence: round.sequence,
      status: round.status,
      duels: round.duels.map((duel) => ({
        id: duel.id,
        position: duel.position,
        tied: duel.tied,
        candidateA: candidateBook(duel.candidateA),
        candidateB: candidateBook(duel.candidateB),
        winner: duel.winnerCandidate ? candidateBook(duel.winnerCandidate) : null,
        myVoteCandidateId: duel.votes[0]?.candidateId ?? null,
      })),
    })),
    winner: edition.winnerCandidate ? candidateBook(edition.winnerCandidate) : null,
  };
}

export async function getClubBookOfYear(usuario: string, year: number) {
  const { club, user, membership } = await requireSocialClubMember(usuario);
  const canAdmin = adminRoles.includes(membership.role);
  const edition = serialize(await loadEdition(club.id, year, user.id), canAdmin) ?? {
    clubId: club.id,
    clubName: club.name,
    year,
    status: 'NOT_STARTED',
    canAdmin,
    candidates: [],
    myQualifyingVotes: [],
    rounds: [],
    winner: null,
  };
  return { ok: true, edition };
}

export async function prepareClubBookOfYear(usuario: string, year: number) {
  const { club } = await requireSocialClubAdmin(usuario);
  const prepared = await eligible(club.id, year);
  const libraryRows = prepared.unresolvedCandidates.length === 0 ? [] : await prisma.library.findMany({
    where: { user: { clubMemberships: { some: { clubId: club.id } } } },
    distinct: ['bookId'],
    orderBy: { book: { title: 'asc' } },
    select: { book: { select: { id: true, title: true, coverUrl: true, author: { select: { name: true } } } } },
  });
  const count = prepared.candidates.length;
  const unresolvedCount = prepared.unresolvedCandidates.length;
  const message = unresolvedCount > 0
    ? `Se han encontrado ${count} candidatas y ${unresolvedCount} lectura${unresolvedCount === 1 ? '' : 's'} histórica${unresolvedCount === 1 ? '' : 's'} pendiente${unresolvedCount === 1 ? '' : 's'} de vincular`
    : count === 0
      ? 'Todavía no hay lecturas oficiales registradas para este año.'
      : count < 2
        ? 'Se necesitan al menos dos candidatas para iniciar la edición.'
        : `${count} lecturas oficiales candidatas`;
  return {
    ok: true,
    year,
    candidates: prepared.candidates.map((candidate) => ({
      id: candidate.book.id,
      bookId: candidate.book.id,
      title: candidate.book.title,
      coverUrl: candidate.book.coverUrl ?? '',
      authorName: candidate.book.author?.name ?? '',
      source: candidate.source,
      clubvisionEdition: candidate.clubvisionEdition,
    })),
    unresolvedCandidates: prepared.unresolvedCandidates,
    linkableBooks: libraryRows.map(({ book }) => ({
      bookId: book.id,
      title: book.title,
      coverUrl: book.coverUrl ?? '',
      authorName: book.author?.name ?? '',
    })),
    canStart: count >= 2,
    message,
  };
}

export async function linkClubBookOfYearHistoricalCandidate(usuario: string, year: number, resultId: string, bookId: string) {
  const { club } = await requireSocialClubAdmin(usuario);
  await prisma.$transaction(async (tx) => {
    const result = await tx.clubvisionResult.findFirst({
      where: { id: resultId, clubId: club.id, edition: { startsWith: `${year}-` }, winnerBookId: null },
      select: { id: true },
    });
    if (!result) throw new ClubBookOfYearError('HISTORICAL_RESULT_NOT_FOUND', 'La lectura histórica ya no está pendiente de vincular', 404);
    const libraryBook = await tx.library.findFirst({
      where: { bookId, user: { clubMemberships: { some: { clubId: club.id } } } },
      select: { bookId: true },
    });
    if (!libraryBook) throw new ClubBookOfYearError('BOOK_NOT_IN_CLUB', 'Selecciona un libro disponible en la biblioteca del club');
    await tx.clubBookOfYearHistoricalLink.upsert({
      where: { resultId: result.id },
      create: { clubId: club.id, year, resultId: result.id, bookId: libraryBook.bookId },
      update: { bookId: libraryBook.bookId, year },
    });
  });
  return prepareClubBookOfYear(usuario, year);
}

async function createBracket(tx: Prisma.TransactionClient, editionId: string, candidates: Array<{ id: string }>, sequence: number, status = ClubBookOfYearRoundStatus.PENDING) {
  const phase = firstPhase(candidates.length);
  const round = await tx.clubBookOfYearRound.create({ data: { editionId, phase, sequence, status } });
  const ordered = [...candidates];
  for (let index = 0; index < ordered.length / 2; index++) {
    await tx.clubBookOfYearDuel.create({ data: { roundId: round.id, position: index + 1, candidateAId: ordered[index]!.id, candidateBId: ordered[ordered.length - 1 - index]!.id } });
  }
  return round;
}

export async function startClubBookOfYear(usuario: string, year: number) {
  const { club } = await requireSocialClubAdmin(usuario);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.clubBookOfYearEdition.findUnique({ where: { clubId_year: { clubId: club.id, year } } });
    if (existing) return;
    const prepared = await eligible(club.id, year, tx);
    if (prepared.candidates.length < 2) throw new ClubBookOfYearError('NOT_ENOUGH_CANDIDATES', 'Se necesitan al menos dos candidatas para iniciar la edición.');
    const qualifying = needsQualifying(prepared.candidates.length);
    const edition = await tx.clubBookOfYearEdition.create({ data: { clubId: club.id, year, status: qualifying ? ClubBookOfYearStatus.QUALIFYING : ClubBookOfYearStatus.ROUND_PENDING, bracketSize: clubBookOfYearBracketSize(prepared.candidates.length), startedAt: new Date() } });
    await tx.clubBookOfYearCandidate.createMany({ data: prepared.candidates.map((candidate, index) => ({ editionId: edition.id, bookId: candidate.bookId, seed: index + 1, titleSnapshot: candidate.book.title, coverUrlSnapshot: candidate.book.coverUrl, authorNameSnapshot: candidate.book.author?.name ?? null })) });
    const candidates = await tx.clubBookOfYearCandidate.findMany({ where: { editionId: edition.id }, orderBy: { seed: 'asc' }, select: { id: true } });
    if (qualifying) await tx.clubBookOfYearRound.create({ data: { editionId: edition.id, phase: ClubBookOfYearPhase.QUALIFYING, sequence: 1, status: ClubBookOfYearRoundStatus.OPEN, openedAt: new Date() } });
    else await createBracket(tx, edition.id, candidates, 1);
  });
  const result = await getClubBookOfYear(usuario, year);
  if (result.edition?.status === ClubBookOfYearStatus.QUALIFYING) await notifyClubBookOfYear(club.id, year, 'QUALIFYING_OPEN', '🗳️ Comienza la clasificación del Libro del año del club');
  return result;
}

export async function voteClubBookOfYearQualifying(usuario: string, year: number, candidateIds: string[]) {
  const { club, user } = await requireSocialClubMember(usuario);
  const edition = await prisma.clubBookOfYearEdition.findUnique({ where: { clubId_year: { clubId: club.id, year } }, include: { candidates: { select: { id: true, tiebreakEligible: true } } } });
  if (!edition || (edition.status !== ClubBookOfYearStatus.QUALIFYING && edition.status !== ClubBookOfYearStatus.TIEBREAK)) throw new ClubBookOfYearError('VOTING_CLOSED', 'La clasificación no está abierta');
  const eligibleCandidates = edition.status === ClubBookOfYearStatus.TIEBREAK ? edition.candidates.filter((candidate) => candidate.tiebreakEligible) : edition.candidates;
  const unique = [...new Set(candidateIds)];
  const max = edition.status === ClubBookOfYearStatus.TIEBREAK ? 1 : Math.min(3, eligibleCandidates.length);
  if (unique.length === 0 || unique.length > max || unique.some((id) => !eligibleCandidates.some((candidate) => candidate.id === id))) throw new ClubBookOfYearError('INVALID_VOTE', `Puedes elegir hasta ${max} libros`);
  await prisma.$transaction(async (tx) => {
    await tx.clubBookOfYearQualifyingVote.deleteMany({ where: { editionId: edition.id, userId: user.id } });
    await tx.clubBookOfYearQualifyingVote.createMany({ data: unique.map((candidateId) => ({ editionId: edition.id, userId: user.id, candidateId })) });
  });
  return getClubBookOfYear(usuario, year);
}

export async function closeClubBookOfYearQualifying(usuario: string, year: number) {
  const { club } = await requireSocialClubAdmin(usuario);
  await prisma.$transaction(async (tx) => {
    const edition = await tx.clubBookOfYearEdition.findUnique({ where: { clubId_year: { clubId: club.id, year } }, include: { candidates: { include: { _count: { select: { qualifyingVotes: true } } } }, rounds: true } });
    if (!edition || (edition.status !== ClubBookOfYearStatus.QUALIFYING && edition.status !== ClubBookOfYearStatus.TIEBREAK)) return;
    const alreadyQualified = edition.candidates.filter((candidate) => candidate.qualified);
    const pool = edition.status === ClubBookOfYearStatus.TIEBREAK ? edition.candidates.filter((candidate) => candidate.tiebreakEligible) : edition.candidates;
    const ranked = [...pool].sort((a, b) => b._count.qualifyingVotes - a._count.qualifyingVotes || (a.seed ?? 0) - (b.seed ?? 0));
    const size = edition.bracketSize!;
    const remaining = size - alreadyQualified.length;
    const cutoffVotes = ranked[remaining - 1]?._count.qualifyingVotes ?? 0;
    const above = ranked.filter((candidate) => candidate._count.qualifyingVotes > cutoffVotes);
    const tiedAtCutoff = ranked.filter((candidate) => candidate._count.qualifyingVotes === cutoffVotes);
    if (tiedAtCutoff.length > remaining - above.length) {
      await tx.clubBookOfYearCandidate.updateMany({ where: { editionId: edition.id }, data: { tiebreakEligible: false } });
      await tx.clubBookOfYearCandidate.updateMany({ where: { id: { in: above.map((candidate) => candidate.id) } }, data: { qualified: true } });
      await tx.clubBookOfYearCandidate.updateMany({ where: { id: { in: tiedAtCutoff.map((candidate) => candidate.id) } }, data: { tiebreakEligible: true } });
      await tx.clubBookOfYearQualifyingVote.deleteMany({ where: { editionId: edition.id } });
      await tx.clubBookOfYearEdition.update({ where: { id: edition.id }, data: { status: ClubBookOfYearStatus.TIEBREAK } });
      return;
    }
    const selected = [...alreadyQualified, ...ranked.slice(0, remaining)];
    await Promise.all(selected.map((candidate, index) => tx.clubBookOfYearCandidate.update({ where: { id: candidate.id }, data: { seed: index + 1 } })));
    await tx.clubBookOfYearRound.updateMany({ where: { editionId: edition.id, phase: ClubBookOfYearPhase.QUALIFYING }, data: { status: ClubBookOfYearRoundStatus.CLOSED, closedAt: new Date() } });
    await createBracket(tx, edition.id, selected, 2);
    await tx.clubBookOfYearEdition.update({ where: { id: edition.id }, data: { status: ClubBookOfYearStatus.ROUND_PENDING } });
  });
  return getClubBookOfYear(usuario, year);
}

export async function openClubBookOfYearRound(usuario: string, year: number, roundId: string) {
  const { club } = await requireSocialClubAdmin(usuario);
  const round = await prisma.clubBookOfYearRound.findFirst({ where: { id: roundId, edition: { clubId: club.id, year } } });
  if (!round || round.status !== ClubBookOfYearRoundStatus.PENDING) throw new ClubBookOfYearError('ROUND_NOT_PENDING', 'La ronda no está pendiente');
  await prisma.$transaction([
    prisma.clubBookOfYearRound.update({ where: { id: round.id }, data: { status: ClubBookOfYearRoundStatus.OPEN, openedAt: new Date() } }),
    prisma.clubBookOfYearEdition.update({ where: { id: round.editionId }, data: { status: round.phase === ClubBookOfYearPhase.TIEBREAK ? ClubBookOfYearStatus.TIEBREAK : ClubBookOfYearStatus.ROUND_OPEN } }),
  ]);
  await notifyClubBookOfYear(club.id, year, `ROUND_${round.id}`, round.phase === ClubBookOfYearPhase.FINAL ? '🏆 La final del Libro del año del club está abierta' : '🗳️ Hay una nueva ronda del Libro del año del club');
  return getClubBookOfYear(usuario, year);
}

export async function voteClubBookOfYearDuel(usuario: string, year: number, duelId: string, candidateId: string) {
  const { club, user } = await requireSocialClubMember(usuario);
  const duel = await prisma.clubBookOfYearDuel.findFirst({ where: { id: duelId, round: { edition: { clubId: club.id, year } } }, include: { round: true } });
  if (!duel || duel.round.status !== ClubBookOfYearRoundStatus.OPEN) throw new ClubBookOfYearError('ROUND_CLOSED', 'La ronda no está abierta');
  if (![duel.candidateAId, duel.candidateBId].includes(candidateId)) throw new ClubBookOfYearError('INVALID_CANDIDATE', 'El libro no pertenece al enfrentamiento');
  await prisma.clubBookOfYearDuelVote.upsert({ where: { duelId_userId: { duelId, userId: user.id } }, create: { duelId, userId: user.id, candidateId }, update: { candidateId } });
  return getClubBookOfYear(usuario, year);
}

export async function closeClubBookOfYearRound(usuario: string, year: number, roundId: string) {
  const { club } = await requireSocialClubAdmin(usuario);
  let winnerTitle: string | null = null;
  await prisma.$transaction(async (tx) => {
    const round = await tx.clubBookOfYearRound.findFirst({ where: { id: roundId, edition: { clubId: club.id, year } }, include: { duels: { include: { votes: true } }, edition: true } });
    if (!round) throw new ClubBookOfYearError('ROUND_NOT_FOUND', 'Ronda no encontrada', 404);
    if (round.status === ClubBookOfYearRoundStatus.CLOSED) return;
    if (round.status !== ClubBookOfYearRoundStatus.OPEN) throw new ClubBookOfYearError('ROUND_CLOSED', 'La ronda no está abierta');
    const winners: string[] = [];
    const tiedDuels: Array<{ candidateAId: string; candidateBId: string }> = [];
    let completedPhase = round.phase;
    for (const duel of round.duels) {
      const a = duel.votes.filter((vote) => vote.candidateId === duel.candidateAId).length;
      const b = duel.votes.filter((vote) => vote.candidateId === duel.candidateBId).length;
      if (a + b === 0) throw new ClubBookOfYearError('DUEL_WITHOUT_VOTES', 'No se puede cerrar un duelo sin votos');
      if (a === b) {
        await tx.clubBookOfYearDuel.update({ where: { id: duel.id }, data: { tied: true } });
        tiedDuels.push({ candidateAId: duel.candidateAId, candidateBId: duel.candidateBId });
        continue;
      }
      const winnerCandidateId = a > b ? duel.candidateAId : duel.candidateBId;
      winners.push(winnerCandidateId);
      await tx.clubBookOfYearDuel.update({ where: { id: duel.id }, data: { winnerCandidateId, tied: false } });
    }
    await tx.clubBookOfYearRound.update({ where: { id: round.id }, data: { status: ClubBookOfYearRoundStatus.CLOSED, closedAt: new Date() } });
    if (tiedDuels.length > 0) {
      const tieRound = await tx.clubBookOfYearRound.create({ data: { editionId: round.editionId, phase: ClubBookOfYearPhase.TIEBREAK, sequence: round.sequence + 1, status: ClubBookOfYearRoundStatus.PENDING } });
      await tx.clubBookOfYearDuel.createMany({ data: tiedDuels.map((duel, index) => ({ roundId: tieRound.id, position: index + 1, candidateAId: duel.candidateAId, candidateBId: duel.candidateBId })) });
      await tx.clubBookOfYearEdition.update({ where: { id: round.editionId }, data: { status: ClubBookOfYearStatus.TIEBREAK } });
      return;
    }
    if (round.phase === ClubBookOfYearPhase.TIEBREAK) {
      const previous = await tx.clubBookOfYearRound.findFirst({ where: { editionId: round.editionId, sequence: { lt: round.sequence }, phase: { not: ClubBookOfYearPhase.TIEBREAK } }, orderBy: { sequence: 'desc' }, include: { duels: true } });
      completedPhase = previous?.phase ?? completedPhase;
      winners.push(...(previous?.duels.flatMap((duel) => duel.winnerCandidateId ? [duel.winnerCandidateId] : []) ?? []));
    }
    if (completedPhase === ClubBookOfYearPhase.FINAL) {
      const winner = await tx.clubBookOfYearCandidate.findUnique({ where: { id: winners[0]! } });
      winnerTitle = winner?.titleSnapshot ?? null;
      await tx.clubBookOfYearEdition.update({ where: { id: round.editionId }, data: { winnerCandidateId: winners[0], status: ClubBookOfYearStatus.FINISHED, finishedAt: new Date() } });
    } else {
      await createBracket(tx, round.editionId, winners.map((id) => ({ id })), round.sequence + 1);
      await tx.clubBookOfYearEdition.update({ where: { id: round.editionId }, data: { status: ClubBookOfYearStatus.ROUND_PENDING } });
    }
  });
  if (winnerTitle) await notifyClubBookOfYear(club.id, year, 'FINISHED', `🏆 ${winnerTitle} es el Libro del año del club ${year}`);
  return getClubBookOfYear(usuario, year);
}

export async function getClubBookOfYearHistory(usuario: string) {
  const { club } = await requireSocialClubMember(usuario);
  const editions = await prisma.clubBookOfYearEdition.findMany({ where: { clubId: club.id, status: ClubBookOfYearStatus.FINISHED }, orderBy: { year: 'desc' }, include: { winnerCandidate: true } });
  return { ok: true, editions: editions.map((edition) => ({ year: edition.year, winner: edition.winnerCandidate ? candidateBook(edition.winnerCandidate) : null })) };
}

export async function cancelClubBookOfYear(usuario: string, year: number) {
  const { club } = await requireSocialClubAdmin(usuario);
  await prisma.$transaction(async (tx) => {
    const edition = await tx.clubBookOfYearEdition.findUnique({ where: { clubId_year: { clubId: club.id, year } }, include: { _count: { select: { qualifyingVotes: true } }, rounds: { include: { duels: { include: { _count: { select: { votes: true } } } } } } } });
    if (!edition) return;
    const hasVotes = edition._count.qualifyingVotes > 0 || edition.rounds.some((round) => round.duels.some((duel) => duel._count.votes > 0));
    if (hasVotes) throw new ClubBookOfYearError('EDITION_HAS_VOTES', 'No se puede cancelar una edición que ya tiene votos');
    await tx.clubBookOfYearEdition.delete({ where: { id: edition.id } });
  });
  return { ok: true, edition: null };
}
