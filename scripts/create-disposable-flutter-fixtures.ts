import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { assertDisposableDatabaseWritesAllowed } from './disposable-db-safety.js';
import { createAccessToken, generateRefreshToken, hashRefreshToken } from '../src/services/auth-crypto.service.js';

assertDisposableDatabaseWritesAllowed();
const MARKER = 'TEST_DISPOSABLE';
const MANIFEST = '/private/tmp/clubreads-disposable-flutter-fixtures.json';
const API = 'http://127.0.0.1:3101/api';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
process.env.AUTH_ACCESS_TOKEN_SECRET = createHash('sha256')
  .update(`disposable:${process.env.DATABASE_URL}`)
  .digest('base64url');

const fixtureId = `${MARKER}_${Date.now()}`;
const club = await prisma.club.findFirst({
  where: { members: { some: {} }, readings: { some: {} } },
  select: {
    id: true, name: true,
    members: { take: 1, orderBy: { joinedAt: 'asc' }, select: { user: { select: { id: true, name: true } } } },
    readings: { take: 1, orderBy: { startedAt: 'desc' }, select: { id: true, book: { select: { title: true } } } },
  },
});
if (!club?.members[0] || !club.readings[0]) throw new Error('No hay club/lectura existente apta');

const covered = await prisma.book.findMany({
  where: { deletedAt: null, coverUrl: { not: null } },
  select: { id: true, title: true, coverUrl: true }, take: 200,
});
const books = [] as typeof covered;
for (const book of covered) {
  if (!book.coverUrl || !/^https?:\/\//.test(book.coverUrl)) continue;
  if (await prisma.book.count({ where: { title: { equals: book.title, mode: 'insensitive' }, deletedAt: null } }) !== 1) continue;
  books.push(book);
  if (books.length === 3) break;
}
if (books.length < 3) throw new Error('No hay tres libros existentes con portada inequívoca');

const resultId = `${fixtureId}_clubvision_result`;
const conversationId = `${fixtureId}_conversation`;
const sessionId = `${fixtureId}_session`;
const chapter = `${MARKER}_CAPITULO_PAGINADO`;
const edition = `1900-${String((Date.now() % 12) + 1).padStart(2, '0')}`;
if (await prisma.clubvisionResult.count({ where: { clubId: club.id, edition } })) {
  throw new Error('La edición artificial ya existe; reintenta');
}
const commentIds = Array.from({ length: 25 }, (_, index) => `${fixtureId}_comment_${String(index + 1).padStart(2, '0')}`);

try {
  await prisma.clubvisionResult.create({ data: {
    id: resultId, clubId: club.id, edition,
    winnerBookId: books[0]!.id, winnerTitle: books[0]!.title,
    secondTitle: books[1]!.title, thirdTitle: books[2]!.title,
    points: 15, createdAt: new Date('1900-01-15T12:00:00.000Z'),
  } });
  await prisma.conversation.create({ data: {
    id: conversationId, readingId: club.readings[0]!.id, title: chapter, order: 9999,
    comments: { create: commentIds.map((id, index) => ({
      id, userId: club.members[0]!.user.id,
      text: `${MARKER}_COMENTARIO_${String(index + 1).padStart(2, '0')}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 10, index, 0)),
    })) },
  } });
  const provisional = generateRefreshToken('new');
  await prisma.authSession.create({ data: {
    id: sessionId, userId: club.members[0]!.user.id,
    refreshTokenHash: hashRefreshToken(provisional),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  } });
  const token = await createAccessToken(club.members[0]!.user.id, sessionId);
  const call = async (action: string, query: Record<string, string>) => {
    const url = new URL(API); url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); return response.json() as Promise<any>;
  };
  const history = await call('historialClubvision', { limit: '50' });
  const row = history.items.find((item: any) => item.mes === edition);
  assert.ok(row);
  assert.deepEqual([row.ganadoraBookId, row.segundaBookId, row.terceraBookId], books.map(({ id }) => id));
  assert.ok([row.ganadoraCoverUrl, row.segundaCoverUrl, row.terceraCoverUrl].every((url: string) => /^https?:\/\//.test(url)));

  const first = await call('comentariosLectura', { libro: club.readings[0]!.book.title, capitulo: chapter, limit: '20' });
  assert.equal(first.items.length, 20); assert.equal(first.hasMore, true); assert.ok(first.nextCursor);
  const second = await call('comentariosLectura', { libro: club.readings[0]!.book.title, capitulo: chapter, limit: '20', cursor: first.nextCursor });
  assert.equal(second.items.length, 5);
  const combined = [...first.items, ...second.items];
  assert.equal(new Set(combined.map((item: any) => item.id)).size, 25);
  const timestamps = combined.map((item: any) => new Date(item.fecha ?? item.createdAt).getTime());
  assert.deepEqual(timestamps, [...timestamps].sort((a, b) => a - b));

  const manifest = {
    marker: MARKER, createdAt: new Date().toISOString(), database: 'clubreads_disposable_test',
    artificial: { clubvisionResultIds: [resultId], conversationIds: [conversationId], commentIds, authSessionIds: [sessionId] },
    existingReferences: { clubId: club.id, readingId: club.readings[0]!.id, userId: club.members[0]!.user.id, bookIds: books.map(({ id }) => id) },
  };
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
  await chmod(MANIFEST, 0o600);
  console.log(`Club visible: ${club.name}`);
  console.log(`Lectura visible: ${club.readings[0]!.book.title}`);
  console.log(`Capítulo: ${chapter}`);
  console.log(`Edición histórica: ${edition}`);
  console.log('Portadas históricas verificadas: 3');
  console.log('Comentarios: página 1=20, página 2=5, duplicados=0, saltos=0');
  console.log(`Manifiesto privado: ${MANIFEST}`);
} finally {
  await prisma.$disconnect();
}
