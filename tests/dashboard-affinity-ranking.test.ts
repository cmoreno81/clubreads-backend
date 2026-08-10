import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getAnnualAffinityRanking } from '../src/services/dashboard.service.js';

type Query = Record<string, unknown>;

function member(userId: string, name: string, avatarUrl: string | null = null) {
  return {
    userId,
    user: { id: `public-${userId}`, name, avatarUrl },
  };
}

function fakeDataSource(options: {
  myBookIds: string[];
  members: ReturnType<typeof member>[];
  otherCompletions: Array<{ userId: string; bookId: string }>;
}) {
  const completionQueries: Query[] = [];
  const memberQueries: Query[] = [];

  return {
    completionQueries,
    memberQueries,
    source: {
      readingCompletion: {
        async findMany(query: Query) {
          completionQueries.push(query);
          return completionQueries.length === 1
            ? options.myBookIds.map((bookId) => ({ bookId }))
            : options.otherCompletions;
        },
      },
      clubMember: {
        async findMany(query: Query) {
          memberQueries.push(query);
          return options.members;
        },
      },
    },
  };
}

const yearStart = new Date('2026-01-01T00:00:00.000Z');

test('calcula el ranking correcto con una única consulta para las demás miembros', async () => {
  const members = [
    member('u1', 'Ana', '/ana.png'),
    member('u2', 'Bea'),
    member('u3', 'Carmen'),
  ];
  const fake = fakeDataSource({
    myBookIds: ['b1', 'b2', 'b3'],
    members,
    otherCompletions: [
      { userId: 'u1', bookId: 'b1' },
      { userId: 'u1', bookId: 'b2' },
      { userId: 'u2', bookId: 'b1' },
    ],
  });

  const result = await getAnnualAffinityRanking(
    'active-club',
    'current-user',
    yearStart,
    fake.source,
  );

  assert.deepEqual(result, [
    {
      id: 'public-u1',
      nombre: 'Ana',
      avatarUrl: '/ana.png',
      librosComunes: 2,
    },
    {
      id: 'public-u2',
      nombre: 'Bea',
      avatarUrl: '',
      librosComunes: 1,
    },
  ]);
  assert.equal(fake.completionQueries.length, 2);
  const nextYearStart = new Date('2027-01-01T00:00:00.000Z');
  assert.deepEqual(fake.completionQueries[0], {
    where: {
      userId: 'current-user',
      finishedAt: { gte: yearStart, lt: nextYearStart },
      isReread: false,
    },
    select: { bookId: true },
  });
  assert.deepEqual(fake.memberQueries[0], {
    where: { clubId: 'active-club', userId: { not: 'current-user' } },
    select: {
      userId: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
  assert.deepEqual(fake.completionQueries[1], {
    where: {
      userId: { in: ['u1', 'u2', 'u3'] },
      finishedAt: { gte: yearStart, lt: nextYearStart },
      isReread: false,
      bookId: { in: ['b1', 'b2', 'b3'] },
    },
    select: { userId: true, bookId: true },
  });
});

test('mantiene orden descendente, elimina ceros y limita a cinco', async () => {
  const members = Array.from({ length: 7 }, (_, index) =>
    member(`u${index + 1}`, `Lectora ${index + 1}`),
  );
  const otherCompletions = members.flatMap((item, index) =>
    Array.from({ length: 7 - index }, (_, bookIndex) => ({
      userId: item.userId,
      bookId: `b${bookIndex + 1}`,
    })),
  );
  const fake = fakeDataSource({
    myBookIds: Array.from({ length: 7 }, (_, index) => `b${index + 1}`),
    members: [...members, member('zero', 'Sin coincidencias')],
    otherCompletions,
  });

  const result = await getAnnualAffinityRanking('club', 'me', yearStart, fake.source);

  assert.deepEqual(result.map((item) => item.librosComunes), [7, 6, 5, 4, 3]);
  assert.equal(result.length, 5);
  assert.ok(result.every((item) => item.librosComunes > 0));
  assert.equal(fake.completionQueries.length, 2);
});

test('sin libros propios devuelve vacío sin consultar miembros ni sus finalizaciones', async () => {
  const fake = fakeDataSource({
    myBookIds: [],
    members: [member('u1', 'Ana')],
    otherCompletions: [],
  });

  const result = await getAnnualAffinityRanking('club', 'me', yearStart, fake.source);

  assert.deepEqual(result, []);
  assert.equal(fake.memberQueries.length, 0);
  assert.equal(fake.completionQueries.length, 1);
});

test('sin otras miembros devuelve vacío sin consultar sus finalizaciones', async () => {
  const fake = fakeDataSource({
    myBookIds: ['b1'],
    members: [],
    otherCompletions: [],
  });

  const result = await getAnnualAffinityRanking('club', 'me', yearStart, fake.source);

  assert.deepEqual(result, []);
  assert.equal(fake.memberQueries.length, 1);
  assert.equal(fake.completionQueries.length, 1);
});

test('el índice existente cubre usuario, relectura y rango de finalización', () => {
  const schema = readFileSync(
    new URL('../prisma/schema.prisma', import.meta.url),
    'utf8',
  );
  const model = schema.match(/model ReadingCompletion \{[\s\S]*?\n\}/)?.[0];

  assert.ok(model);
  assert.match(model, /@@index\(\[userId, isReread, finishedAt\]\)/);
});
