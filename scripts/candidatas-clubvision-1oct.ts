import 'dotenv/config';
import { Priority, ReadingStatus } from '@prisma/client';
import { prisma } from '../src/prisma.js';

/**
 * Cuenta las candidatas elegibles a Clubvisión para dos clubs concretos en
 * la edición "2026-10" (la que se abre el 1 de octubre), replicando la
 * lógica de `calcularCandidatasElegibles` en src/services/clubvision.service.ts
 * de forma read-only (no crea ni modifica nada).
 *
 * Uso: npx tsx scripts/candidatas-clubvision-1oct.ts
 */

const EDITION = '2026-10';
const NOW = new Date('2026-10-01T00:00:00+02:00');
const NOMBRES_CLUBS = ['Nuestros gustos son clichés', 'Páginas Encantadas'];

async function candidatasElegibles(clubId: string, edition: string) {
  const previousWinners = await prisma.clubvisionResult.findMany({
    where: { clubId, edition: { not: edition }, winnerBookId: { not: null } },
    select: { winnerBookId: true },
    distinct: ['winnerBookId'],
  });
  const excludedBookIds = previousWinners.flatMap((r) =>
    r.winnerBookId ? [r.winnerBookId] : [],
  );

  const tooManyFinished = await prisma.library.groupBy({
    by: ['bookId'],
    where: {
      status: ReadingStatus.FINISHED,
      user: { clubMemberships: { some: { clubId } } },
    },
    _count: { userId: true },
    having: { userId: { _count: { gt: 3 } } },
  });
  const tooManyFinishedBookIds = tooManyFinished.map((r) => r.bookId);

  const allExcluded = [...excludedBookIds, ...tooManyFinishedBookIds];
  const pendingEntries = await prisma.library.findMany({
    where: {
      status: ReadingStatus.PENDING,
      user: { clubMemberships: { some: { clubId } } },
      ...(allExcluded.length > 0 ? { bookId: { notIn: allExcluded } } : {}),
      book: { OR: [{ publicationDate: null }, { publicationDate: { lte: NOW } }] },
    },
    select: { userId: true, bookId: true, priority: true },
  });

  const importedKeys =
    pendingEntries.length > 0
      ? new Set(
          (
            await prisma.importRowReceipt.findMany({
              where: {
                OR: pendingEntries.map((e) => ({ userId: e.userId, bookId: e.bookId })),
              },
              select: { userId: true, bookId: true },
            })
          ).map((r) => `${r.userId}:${r.bookId}`),
        )
      : new Set<string>();

  const genuinePending = pendingEntries.filter(
    (e) => !importedKeys.has(`${e.userId}:${e.bookId}`),
  );

  const countByBook = new Map<string, number>();
  const highCountByBook = new Map<string, number>();
  for (const entry of genuinePending) {
    countByBook.set(entry.bookId, (countByBook.get(entry.bookId) ?? 0) + 1);
    if (entry.priority === Priority.HIGH) {
      highCountByBook.set(entry.bookId, (highCountByBook.get(entry.bookId) ?? 0) + 1);
    }
  }

  const eligibleBookIds = [...countByBook.entries()]
    .filter(([, count]) => count >= 3)
    .map(([bookId]) => bookId);

  return eligibleBookIds.sort((a, b) => {
    const highDiff = (highCountByBook.get(b) ?? 0) - (highCountByBook.get(a) ?? 0);
    if (highDiff !== 0) return highDiff;
    return (countByBook.get(b) ?? 0) - (countByBook.get(a) ?? 0);
  });
}

async function main() {
  for (const nombre of NOMBRES_CLUBS) {
    const club = await prisma.club.findFirst({
      where: { name: { contains: nombre } },
    });
    if (!club) {
      console.log(`\n❌ No se ha encontrado ningún club llamado "${nombre}"`);
      continue;
    }

    const bookIds = await candidatasElegibles(club.id, EDITION);
    const libros = bookIds.length
      ? await prisma.book.findMany({
          where: { id: { in: bookIds } },
          select: { id: true, title: true },
        })
      : [];
    const titleById = new Map(libros.map((l) => [l.id, l.title]));

    console.log(`\n📚 ${nombre} (edición ${EDITION}, simulando ${NOW.toISOString()})`);
    console.log(`   Candidatas elegibles: ${bookIds.length}`);
    for (const id of bookIds) {
      console.log(`   - ${titleById.get(id) ?? id}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });