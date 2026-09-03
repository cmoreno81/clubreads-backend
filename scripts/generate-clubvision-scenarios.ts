import { PrismaClient, type ClubvisionKind, type ClubvisionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { hashPassword } from '../src/services/auth-crypto.service.js';
import { assertDisposableDatabaseWritesAllowed } from './disposable-db-safety.js';

assertDisposableDatabaseWritesAllowed();

const MARKER = 'CV_SCENARIO_';
const PASSWORD = 'ClubReadsTest2026!';
const SIMULATED_NOW = new Date('2026-09-10T10:00:00.000Z');
const MANIFEST = '/private/tmp/clubreads-clubvision-scenarios.json';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

type Scenario = {
  key: string;
  label: string;
  members?: number;
  sharedBooks?: number;
  kind?: ClubvisionKind;
  status?: ClubvisionStatus;
  votes?: number;
  result?: boolean;
  reading?: boolean;
  oldClub?: boolean;
  recommendedDate?: string;
};

const scenarios: Scenario[] = [
  { key: 'WELCOME_MEMBERS', label: 'Bienvenida bloqueada: faltan miembros', members: 2, sharedBooks: 5 },
  { key: 'WELCOME_BOOKS', label: 'Bienvenida bloqueada: faltan libros compartidos', members: 3, sharedBooks: 3 },
  { key: 'WELCOME_OLD', label: 'Bienvenida bloqueada: club con más de 45 días', members: 3, sharedBooks: 5, oldClub: true },
  { key: 'WELCOME_READY', label: 'Bienvenida lista para iniciar', members: 3, sharedBooks: 5, recommendedDate: '2026-09-10T10:00:00+02:00' },
  { key: 'WELCOME_VOTING', label: 'Bienvenida en votación parcial', members: 3, sharedBooks: 5, kind: 'WELCOME', status: 'VOTACION', votes: 1 },
  { key: 'WELCOME_RESULTS', label: 'Bienvenida mostrando resultados', members: 3, sharedBooks: 5, kind: 'WELCOME', status: 'RESULTADOS', votes: 3, result: true },
  { key: 'WELCOME_READING', label: 'Bienvenida convertida en lectura', members: 3, sharedBooks: 5, kind: 'WELCOME', status: 'LECTURA', votes: 3, result: true, reading: true },
  { key: 'WELCOME_NO_VOTES', label: 'Bienvenida finalizada sin votos', members: 3, sharedBooks: 5, kind: 'WELCOME', status: 'FINALIZADA' },
  { key: 'MONTHLY_VOTING', label: 'Clubvisión mensual en votación', members: 4, sharedBooks: 6, kind: 'MONTHLY', status: 'VOTACION', votes: 2, recommendedDate: '2026-09-01T10:00:00+02:00' },
  { key: 'MONTHLY_RESULTS', label: 'Clubvisión mensual en resultados', members: 4, sharedBooks: 6, kind: 'MONTHLY', status: 'RESULTADOS', votes: 4, result: true, recommendedDate: '2026-09-03T10:00:00+02:00' },
  { key: 'MONTHLY_READING', label: 'Clubvisión mensual convertida en lectura', members: 4, sharedBooks: 6, kind: 'MONTHLY', status: 'LECTURA', votes: 4, result: true, reading: true, recommendedDate: '2026-09-04T10:00:00+02:00' },
];

function id(...parts: string[]) {
  return `${MARKER}${parts.join('_')}`;
}

async function removePreviousRun() {
  const users = await prisma.user.findMany({
    where: { id: { startsWith: MARKER } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (userIds.length) {
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { activeClubId: null } });
    await prisma.library.deleteMany({ where: { userId: { in: userIds } } });
  }
  await prisma.club.deleteMany({ where: { id: { startsWith: MARKER } } });
  await prisma.book.deleteMany({ where: { id: { startsWith: MARKER } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: MARKER } } });
  await prisma.author.deleteMany({ where: { id: { startsWith: MARKER } } });
  await prisma.genre.deleteMany({ where: { id: { startsWith: MARKER } } });
}

const passwordHash = await hashPassword(PASSWORD);
const manifest: Array<Record<string, unknown>> = [];

try {
  await removePreviousRun();

  for (const scenario of scenarios) {
    const memberCount = scenario.members ?? 3;
    const sharedBookCount = scenario.sharedBooks ?? 5;
    const genreId = id(scenario.key, 'GENRE');
    const authorId = id(scenario.key, 'AUTHOR');
    const clubId = id(scenario.key, 'CLUB');
    const createdAt = scenario.oldClub
      ? new Date('2026-06-01T10:00:00.000Z')
      : new Date('2026-09-05T10:00:00.000Z');

    await prisma.genre.create({ data: { id: genreId, name: `${MARKER}${scenario.key} · Fantasía` } });
    await prisma.author.create({ data: { id: authorId, name: `${MARKER}${scenario.key} · Autora` } });

    const users = await Promise.all(Array.from({ length: memberCount }, async (_, index) => {
      const number = index + 1;
      return prisma.user.create({ data: {
        id: id(scenario.key, `USER${number}`),
        name: `${MARKER}${scenario.key}_Lectora_${number}`,
        email: `cv.${scenario.key.toLowerCase()}.${number}@clubreads.test`,
        passwordHash,
        passwordSetAt: createdAt,
        createdAt,
      } });
    }));

    await prisma.club.create({ data: {
      id: clubId,
      name: scenario.label,
      slug: `cv-scenario-${scenario.key.toLowerCase().replaceAll('_', '-')}`,
      description: `${MARKER} Escenario desechable. No pertenece a producción.`,
      inviteCode: `CV-${scenario.key}`,
      ownerId: users[0]!.id,
      createdAt,
      members: { create: users.map((user, index) => ({
        userId: user.id,
        role: index === 0 ? 'OWNER' : 'MEMBER',
        joinedAt: createdAt,
      })) },
    } });
    await prisma.user.updateMany({
      where: { id: { in: users.map(({ id }) => id) } },
      data: { activeClubId: clubId },
    });

    const books = await Promise.all(Array.from({ length: Math.max(sharedBookCount, 5) }, async (_, index) => {
      const number = index + 1;
      return prisma.book.create({ data: {
        id: id(scenario.key, `BOOK${number}`),
        title: `${scenario.label} · Libro ${number}`,
        authorId,
        genreId,
        createdById: users[index % users.length]!.id,
        publicationDate: new Date('2026-01-15T00:00:00.000Z'),
        publicationYear: 2026,
        totalPages: 320 + number * 12,
        publisher: 'Editorial Simulación',
        synopsis: `${MARKER} Libro artificial para recorrer Clubvisión sin tocar datos reales.`,
      } });
    }));

    for (const book of books.slice(0, sharedBookCount)) {
      const interestedReaders = scenario.kind === 'MONTHLY' ? 3 : 2;
      for (const user of users.slice(0, Math.min(interestedReaders, users.length))) {
        await prisma.library.create({ data: {
          id: id(scenario.key, user.id.split('_').at(-1)!, book.id.split('_').at(-1)!),
          userId: user.id,
          bookId: book.id,
          status: 'PENDING',
          priority: 'HIGH',
        } });
      }
    }

    let clubvisionId: string | null = null;
    let edition: string | null = null;
    if (scenario.kind && scenario.status) {
      clubvisionId = id(scenario.key, 'CLUBVISION');
      edition = scenario.kind === 'WELCOME'
        ? `WELCOME-${scenario.key}-2026-09-08T10:00:00.000Z`
        : '2026-09';
      const votingEndsAt = scenario.kind === 'WELCOME'
        ? new Date('2026-09-12T10:00:00.000Z')
        : null;
      const resultsEndsAt = scenario.kind === 'WELCOME'
        ? new Date('2026-09-13T10:00:00.000Z')
        : null;
      await prisma.clubvision.create({ data: {
        id: clubvisionId,
        clubId,
        edition,
        kind: scenario.kind,
        status: scenario.status,
        title: scenario.kind === 'WELCOME' ? '✨ Clubvisión de bienvenida' : '🎤 Clubvisión mensual',
        message: scenario.status === 'VOTACION' ? '🗳️ Ya podéis votar' : 'Escenario preparado',
        openedAt: new Date('2026-09-08T10:00:00.000Z'),
        votingEndsAt,
        resultsEndsAt,
        closedAt: ['LECTURA', 'FINALIZADA'].includes(scenario.status) ? SIMULATED_NOW : null,
        finishedAt: scenario.status === 'FINALIZADA' ? SIMULATED_NOW : null,
        winnerBookId: scenario.result ? books[0]!.id : null,
        candidates: { create: books.slice(0, 5).map((book, index) => ({
          id: id(scenario.key, `CANDIDATE${index + 1}`),
          bookId: book.id,
          order: index + 1,
        })) },
      } });

      const voteCount = Math.min(scenario.votes ?? 0, users.length);
      for (const [userIndex, user] of users.slice(0, voteCount).entries()) {
        for (let position = 1; position <= 5; position += 1) {
          const candidateIndex = (position - 1 + userIndex) % 5;
          await prisma.clubvisionVote.create({ data: {
            id: id(scenario.key, `VOTE${userIndex + 1}_${position}`),
            clubvisionId,
            userId: user.id,
            candidateId: id(scenario.key, `CANDIDATE${candidateIndex + 1}`),
            position,
            points: [12, 10, 8, 7, 6][position - 1]!,
          } });
        }
      }

      if (scenario.result) {
        await prisma.clubvisionResult.create({ data: {
          id: id(scenario.key, 'RESULT'),
          clubId,
          edition,
          winnerBookId: books[0]!.id,
          winnerTitle: books[0]!.title,
          points: 36,
          secondTitle: books[1]!.title,
          thirdTitle: books[2]!.title,
        } });
      }
      if (scenario.reading) {
        await prisma.reading.create({ data: {
          id: id(scenario.key, 'READING'),
          clubId,
          bookId: books[0]!.id,
          type: 'CLUBVISION',
          status: 'ACTIVE',
          chapters: 24,
          hasPrologue: true,
          hasEpilogue: true,
          startedAt: SIMULATED_NOW,
        } });
      }
    }

    manifest.push({
      key: scenario.key,
      label: scenario.label,
      clubId,
      ownerEmail: users[0]!.email,
      memberEmails: users.slice(1).map(({ email }) => email),
      password: PASSWORD,
      recommendedSimulatedDate: scenario.recommendedDate ?? SIMULATED_NOW.toISOString(),
      clubvisionId,
      edition,
    });
  }

  const { writeFile, chmod } = await import('node:fs/promises');
  await writeFile(MANIFEST, JSON.stringify({
    marker: MARKER,
    database: 'clubreads_disposable_test',
    simulatedDate: SIMULATED_NOW.toISOString(),
    apiBaseUrl: 'http://127.0.0.1:3000/api',
    scenarios: manifest,
  }, null, 2), { mode: 0o600 });
  await chmod(MANIFEST, 0o600);

  console.log(`Creados ${scenarios.length} escenarios de Clubvisión.`);
  console.log(`Contraseña común: ${PASSWORD}`);
  console.log(`Fecha simulada recomendada: ${SIMULATED_NOW.toISOString()}`);
  console.log(`Manifiesto privado: ${MANIFEST}`);
  for (const scenario of manifest) console.log(`- ${scenario.label}: ${scenario.ownerEmail}`);
} finally {
  await prisma.$disconnect();
}
