import { prisma } from './src/prisma.js';
const u = await prisma.user.findUnique({ where: { email: 'c.moreno.benavente@gmail.com' }, select: { id: true } });
const rows = await prisma.readingCompletion.findMany({
  where: { userId: u!.id, finishedAt: { gte: new Date('2026-01-01T00:00:00Z') }, readingFormat: null },
  select: { id: true, finishedAt: true, book: { select: { title: true, author: { select: { name: true } } } } },
  orderBy: { finishedAt: 'asc' },
});
rows.forEach((r, i) => console.log(`${i + 1}. ${r.finishedAt.toISOString().slice(0, 10)} · ${r.book.title} — ${r.book.author?.name ?? 'sin autora'}`));
console.log('total', rows.length);
await prisma.$disconnect();
