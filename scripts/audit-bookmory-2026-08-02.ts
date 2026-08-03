import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import { prisma } from '../src/prisma.js';

const START = new Date('2026-08-02T00:00:00.000Z');
const END = new Date('2026-08-03T00:00:00.000Z');

function personalRelations(book: any, users: Map<string, string>) {
  return {
    bibliotecas: (book.library ?? []).map((item: any) => ({
      id: item.id,
      usuaria: users.get(item.userId) ?? item.userId,
      status: item.status,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      formato: item.readingFormat,
    })),
    finalizaciones: (book.readingCompletions ?? []).map((item: any) => ({
      id: item.id,
      usuaria: users.get(item.userId) ?? item.userId,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      valoracion: item.rating,
      resena: item.review,
      formato: item.readingFormat,
      isReread: item.isReread,
    })),
    resenas: (book.reviews ?? []).map((item: any) => ({
      id: item.id,
      usuaria: users.get(item.userId) ?? item.userId,
      valoracion: item.rating,
      resena: item.review,
    })),
  };
}

async function main() {
  const batchBooks = await prisma.book.findMany({
    where: { createdAt: { gte: START, lt: END } },
    select: { id: true },
  });
  const batchIds = batchBooks.map(({ id }) => id);
  const redirects = await prisma.bookRedirect.findMany({
    where: {
      OR: [
        { oldBookId: { in: batchIds } },
        { canonicalBookId: { in: batchIds } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  const pairIds = [...new Set(redirects.flatMap((item) => [item.oldBookId, item.canonicalBookId]))];
  const [books, audits, userRows] = await Promise.all([
    prisma.book.findMany({
      where: { id: { in: pairIds } },
      include: {
        author: true,
        library: true,
        readingCompletions: true,
        reviews: true,
      },
    }),
    prisma.bookMergeAudit.findMany({
      where: { sourceBookId: { in: redirects.map(({ oldBookId }) => oldBookId) } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const users = new Map(userRows.map((user) => [user.id, user.name]));
  const byId = new Map(books.map((book) => [book.id, book]));
  const latestAudit = new Map<string, typeof audits[number]>();
  for (const audit of audits) {
    if (!latestAudit.has(audit.sourceBookId)) latestAudit.set(audit.sourceBookId, audit);
  }
  const pairs = redirects.map((redirect) => {
    const audit = latestAudit.get(redirect.oldBookId);
    const snapshot = audit?.snapshot as any;
    const source = snapshot?.source ?? byId.get(redirect.oldBookId);
    const canonical = byId.get(redirect.canonicalBookId);
    return {
      source: source ? {
        id: source.id,
        titulo: source.title,
        autor: source.author?.name ?? null,
        isbn: source.isbn,
        portada: source.coverUrl,
        ...personalRelations(source, users),
      } : { id: redirect.oldBookId },
      canonical: canonical ? {
        id: canonical.id,
        titulo: canonical.title,
        autor: canonical.author?.name ?? null,
        isbn: canonical.isbn,
        portada: canonical.coverUrl,
        ...personalRelations(canonical, users),
      } : { id: redirect.canonicalBookId },
      motivo: redirect.reason,
      fusionadoAt: redirect.createdAt,
      auditoriaId: audit?.id ?? null,
    };
  });
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY',
    batchWindowUtc: { start: START, endExclusive: END },
    batchBooks: batchIds.length,
    suspiciousPairs: pairs.length,
    pairs,
  };
  await mkdir('reports', { recursive: true });
  const path = 'reports/bookmory-2026-08-02-read-only.json';
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
  const markdownPath = 'reports/bookmory-2026-08-02-read-only.md';
  const rows = pairs.map((pair, index) =>
    `| ${index + 1} | ${pair.source.titulo ?? ''} | ${pair.source.id} | ${pair.source.autor ?? ''} | ${pair.canonical.id} | ${pair.canonical.autor ?? ''} | ${pair.motivo ?? ''} |`
  );
  await writeFile(markdownPath, [
    '# Auditoría Bookmory — lote del 2 de agosto de 2026',
    '',
    '- Modo: `READ_ONLY`',
    `- Libros creados en la ventana UTC: ${batchIds.length}`,
    `- Pares sospechosos con redirección auditada: ${pairs.length}`,
    '- El JSON adjunto contiene portadas, ISBN, bibliotecas, fechas, formatos, valoraciones, reseñas e `isReread` de cada copia.',
    '',
    '| # | Título | ID retirado | Autor importado | ID canónico | Autor canónico | Motivo |',
    '|---:|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n'), 'utf8');
  console.log(JSON.stringify({ path, markdownPath, batchBooks: batchIds.length, suspiciousPairs: pairs.length }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
