import { readFile, unlink } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertDisposableDatabaseWritesAllowed } from './disposable-db-safety.js';

assertDisposableDatabaseWritesAllowed();
if (process.env.CONFIRM_FIXTURE_CLEANUP !== 'DELETE_TEST_DISPOSABLE_FIXTURES') {
  throw new Error('Falta CONFIRM_FIXTURE_CLEANUP=DELETE_TEST_DISPOSABLE_FIXTURES');
}
const path = '/private/tmp/clubreads-disposable-flutter-fixtures.json';
const manifest = JSON.parse(await readFile(path, 'utf8'));
if (manifest.marker !== 'TEST_DISPOSABLE' || manifest.database !== 'clubreads_disposable_test') throw new Error('Manifiesto no válido');
const ids = manifest.artificial;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const before = {
  comments: await prisma.comment.count(),
  conversations: await prisma.conversation.count(),
  clubvisionResults: await prisma.clubvisionResult.count(),
  authSessions: await prisma.authSession.count(),
};
const present = {
  comments: await prisma.comment.count({ where: { id: { in: ids.commentIds } } }),
  conversations: await prisma.conversation.count({ where: { id: { in: ids.conversationIds } } }),
  clubvisionResults: await prisma.clubvisionResult.count({ where: { id: { in: ids.clubvisionResultIds } } }),
  authSessions: await prisma.authSession.count({ where: { id: { in: ids.authSessionIds } } }),
};
const deleted = await prisma.$transaction(async (tx) => ({
  comments: (await tx.comment.deleteMany({ where: { id: { in: ids.commentIds } } })).count,
  conversations: (await tx.conversation.deleteMany({ where: { id: { in: ids.conversationIds } } })).count,
  clubvisionResults: (await tx.clubvisionResult.deleteMany({ where: { id: { in: ids.clubvisionResultIds } } })).count,
  authSessions: (await tx.authSession.deleteMany({ where: { id: { in: ids.authSessionIds } } })).count,
}));
const after = {
  comments: await prisma.comment.count(),
  conversations: await prisma.conversation.count(),
  clubvisionResults: await prisma.clubvisionResult.count(),
  authSessions: await prisma.authSession.count(),
};
for (const table of Object.keys(before) as Array<keyof typeof before>) {
  if (deleted[table] !== present[table] || after[table] !== before[table] - present[table]) {
    throw new Error(`Los recuentos de ${table} no coinciden; el manifiesto se conserva`);
  }
}
const exactRemaining =
  await prisma.comment.count({ where: { id: { in: ids.commentIds } } }) +
  await prisma.conversation.count({ where: { id: { in: ids.conversationIds } } }) +
  await prisma.clubvisionResult.count({ where: { id: { in: ids.clubvisionResultIds } } }) +
  await prisma.authSession.count({ where: { id: { in: ids.authSessionIds } } });
const markerRemaining =
  await prisma.comment.count({ where: { OR: [{ id: { startsWith: 'TEST_DISPOSABLE' } }, { text: { contains: 'TEST_DISPOSABLE' } }] } }) +
  await prisma.conversation.count({ where: { OR: [{ id: { startsWith: 'TEST_DISPOSABLE' } }, { title: { contains: 'TEST_DISPOSABLE' } }] } }) +
  await prisma.clubvisionResult.count({ where: { id: { startsWith: 'TEST_DISPOSABLE' } } }) +
  await prisma.authSession.count({ where: { id: { startsWith: 'TEST_DISPOSABLE' } } });
const checks = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
  SELECT
    (SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated) AS unvalidated_foreign_keys,
    (SELECT count(*) FROM "Comment" c LEFT JOIN "Conversation" v ON v.id=c."conversationId" LEFT JOIN "User" u ON u.id=c."userId" WHERE v.id IS NULL OR u.id IS NULL) AS orphan_comments,
    (SELECT count(*) FROM "Conversation" v LEFT JOIN "Reading" r ON r.id=v."readingId" WHERE r.id IS NULL) AS orphan_conversations,
    (SELECT count(*) FROM "ClubvisionResult" x LEFT JOIN "Club" c ON c.id=x."clubId" WHERE c.id IS NULL) AS orphan_clubvision_results,
    (SELECT count(*) FROM "AuthSession" s LEFT JOIN "User" u ON u.id=s."userId" WHERE u.id IS NULL) AS orphan_auth_sessions
`);
const integrity = checks[0]!;
if (exactRemaining !== 0 || markerRemaining !== 0 || Object.values(integrity).some((value) => value !== 0n)) {
  throw new Error('La validación final falló; el manifiesto se conserva');
}
await prisma.$disconnect();
await unlink(path);
console.log(JSON.stringify({ deleted, exactIdsRemaining: 0, markerRowsRemaining: 0, integrity: Object.fromEntries(Object.entries(integrity).map(([key, value]) => [key, Number(value)])), countsBefore: before, countsAfter: after, manifestDeleted: true }, null, 2));
