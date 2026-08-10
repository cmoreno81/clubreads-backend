import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { assertDisposableDatabaseWritesAllowed } from './disposable-db-safety.js';
import { hashPassword } from '../src/services/auth-crypto.service.js';

assertDisposableDatabaseWritesAllowed();
const baseUrl = process.env.DISPOSABLE_BACKEND_URL ?? 'http://127.0.0.1:3101';
const marker = '__codex_disposable__';
const ids = {
  owner: `${marker}owner`, member: `${marker}member`, club: `${marker}club`,
  genre: `${marker}genre`, book: `${marker}book`, library: `${marker}library`,
  completion: `${marker}completion`, reading: `${marker}reading`,
  conversation1: `${marker}conversation1`, conversation2: `${marker}conversation2`,
  comment1: `${marker}comment1`, comment2: `${marker}comment2`,
};
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function cleanup() {
  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { id: { startsWith: marker } } }),
    prisma.conversation.deleteMany({ where: { id: { startsWith: marker } } }),
    prisma.reading.deleteMany({ where: { id: { startsWith: marker } } }),
    prisma.readingCompletion.deleteMany({ where: { id: { startsWith: marker } } }),
    prisma.library.deleteMany({ where: { id: { startsWith: marker } } }),
    prisma.notification.deleteMany({ where: { OR: [{ userId: { startsWith: marker } }, { clubId: { startsWith: marker } }] } }),
    prisma.clubMember.deleteMany({ where: { OR: [{ userId: { startsWith: marker } }, { clubId: { startsWith: marker } }] } }),
    prisma.club.deleteMany({ where: { id: { startsWith: marker } } }),
    prisma.book.deleteMany({ where: { id: { startsWith: marker } } }),
    prisma.genre.deleteMany({ where: { id: { startsWith: marker } } }),
    prisma.authSession.deleteMany({ where: { userId: { startsWith: marker } } }),
    prisma.user.deleteMany({ where: { id: { startsWith: marker } } }),
  ]);
}

type TimedResponse = { status: number; body: any; ms: number };
async function request(action: string, options: { method?: string; token?: string; body?: object; query?: Record<string, string> } = {}): Promise<TimedResponse> {
  const url = new URL('/api', baseUrl);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const started = performance.now();
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'content-type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json(), ms: performance.now() - started };
}

function containsValue(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsValue(item, expected));
  return Boolean(value && typeof value === 'object' && Object.values(value).some((item) => containsValue(item, expected)));
}

const results: Record<string, unknown> = { checks: [], failures: [], latenciesMs: {} };
const checks = results.checks as string[];
const failures = results.failures as string[];
try {
  await cleanup();
  const password = 'Disposable-only-password-42!';
  const passwordHash = await hashPassword(password);
  await prisma.user.createMany({ data: [
    { id: ids.owner, name: `${marker}owner`, email: `${marker}owner@example.invalid`, passwordHash, activeClubId: null },
    { id: ids.member, name: `${marker}member`, email: `${marker}member@example.invalid`, passwordHash, activeClubId: null },
  ] });
  await prisma.genre.create({ data: { id: ids.genre, name: `${marker}genre` } });
  await prisma.book.create({ data: { id: ids.book, title: `${marker}book`, genreId: ids.genre, coverUrl: 'https://example.invalid/disposable-cover.jpg', createdById: ids.owner } });
  await prisma.club.create({ data: { id: ids.club, name: `${marker}club`, slug: `${marker}club`, ownerId: ids.owner, members: { create: [{ userId: ids.owner, role: 'OWNER' }, { userId: ids.member, role: 'MEMBER' }] } } });
  await prisma.user.updateMany({ where: { id: { in: [ids.owner, ids.member] } }, data: { activeClubId: ids.club } });
  await prisma.library.create({ data: { id: ids.library, userId: ids.owner, bookId: ids.book, status: 'READING', currentPage: 10 } });
  await prisma.readingCompletion.create({ data: { id: ids.completion, userId: ids.owner, bookId: ids.book, finishedAt: new Date('2026-01-02T00:00:00Z'), rating: 4 } });
  await prisma.reading.create({ data: { id: ids.reading, clubId: ids.club, bookId: ids.book, type: 'FREE', status: 'ACTIVE', chapters: 2, conversations: { create: [
    { id: ids.conversation1, title: '1', order: 1, comments: { create: [
      { id: ids.comment1, userId: ids.owner, text: `${marker}older`, createdAt: new Date('2026-01-01T10:00:00Z') },
      { id: ids.comment2, userId: ids.owner, text: `${marker}newer`, createdAt: new Date('2026-01-01T11:00:00Z') },
    ] } },
    { id: ids.conversation2, title: '2', order: 2 },
  ] } } });

  const noToken = await request('dashboard'); assert.equal(noToken.status, 401); checks.push('sin token: 401');
  const badToken = await request('dashboard', { token: 'invalid' }); assert.equal(badToken.status, 401); checks.push('token inválido: 401');
  const login = await request('login', { method: 'POST', body: { email: `${marker}owner@example.invalid`, password } });
  assert.equal(login.status, 200); assert.ok(login.body.accessToken && login.body.refreshToken); checks.push('login');
  let accessToken = login.body.accessToken as string;
  const refresh = await request('refreshToken', { method: 'POST', body: { refreshToken: login.body.refreshToken } });
  assert.equal(refresh.status, 200); assert.ok(refresh.body.accessToken && refresh.body.refreshToken); accessToken = refresh.body.accessToken; checks.push('refresh con rotación');

  const endpoints: Array<[string, Record<string, string>?]> = [
    ['dashboard'], ['perfilUsuario'], ['lecturasActivas'], ['clubvision'],
    ['catalogoGeneral', { limit: '10' }], ['configuracionLectura', { libro: `${marker}book` }],
    ['comentariosLectura', { libro: `${marker}book`, capitulo: '1', limit: '10' }],
  ];
  for (const [action, query] of endpoints) {
    const samples: number[] = [];
    for (let index = 0; index < 4; index++) {
      const response = await request(action, { token: accessToken, query });
      assert.equal(response.status, 200, action); samples.push(Number(response.ms.toFixed(2)));
      if (action === 'perfilUsuario') assert.ok(containsValue(response.body, 'https://example.invalid/disposable-cover.jpg'));
      if (action === 'comentariosLectura') {
        const serialized = JSON.stringify(response.body);
        assert.ok(serialized.indexOf(`${marker}older`) < serialized.indexOf(`${marker}newer`));
      }
    }
    (results.latenciesMs as Record<string, unknown>)[action] = { first: samples[0], subsequent: samples.slice(1) };
    checks.push(action);
  }

  const created = await request('guardarComentarioLectura', { method: 'POST', token: accessToken, body: { libro: `${marker}book`, capitulo: '1', comentario: `${marker}created` } });
  assert.equal(created.status, 200); const createdId = created.body.id ?? created.body.comentario?.id; assert.ok(createdId); checks.push('crear comentario');
  const edited = await request('editarComentario', { method: 'POST', token: accessToken, body: { comentarioId: createdId, comentario: `${marker}updated` } }); assert.equal(edited.status, 200); checks.push('actualizar comentario');
  const memberLogin = await request('login', { method: 'POST', body: { email: `${marker}member@example.invalid`, password } });
  const forbidden = await request('editarClub', { method: 'POST', token: memberLogin.body.accessToken, body: { clubId: ids.club, nombre: `${marker}forbidden` } });
  if ([401, 403].includes(forbidden.status)) checks.push(`operación ajena bloqueada: ${forbidden.status}`);
  else failures.push(`editarClub permitió a MEMBER (HTTP ${forbidden.status})`);
  const deleted = await request('eliminarComentario', { method: 'POST', token: accessToken, body: { comentarioId: createdId } }); assert.equal(deleted.status, 200); checks.push('eliminar comentario');
  const logout = await request('logout', { method: 'POST', token: accessToken, body: {} }); assert.equal(logout.status, 200); checks.push('logout');
  const afterLogout = await request('dashboard', { token: accessToken }); assert.equal(afterLogout.status, 401); checks.push('token revocado: 401');
  results.ok = failures.length === 0;
} finally {
  await cleanup();
  const remaining = await prisma.user.count({ where: { id: { startsWith: marker } } });
  results.artificialRowsRemaining = remaining;
  await prisma.$disconnect();
}
console.log(JSON.stringify(results, null, 2));
