/**
 * Fusiona dos pares de libros duplicados:
 *   1. "Zodiac Academy 1: El despertar" / "Zodiac Academy 1. El despertar. Edición especial"
 *   2. "Una historia de Taipei" (dos registros distintos)
 *
 * En cada caso: mueve todas las relaciones al libro canónico y borra el duplicado.
 */
import { prisma } from '../src/prisma.js';
import { normalizeForComparison } from '../src/utils/text.js';

// ─── Utilidades ────────────────────────────────────────────────────────────────

async function findDuplicates(titleFragment: string) {
  const books = await prisma.book.findMany({
    where: { title: { contains: titleFragment, mode: 'insensitive' }, deletedAt: null },
    include: {
      author: true,
      library: { select: { userId: true, user: { select: { name: true } } } },
      reviews: { select: { userId: true } },
      readings: { select: { id: true } },
      wishlistItems: { select: { userId: true, user: { select: { name: true } } } },
      sources: { select: { source: true } },
      clubvisionCandidates: { select: { id: true } },
      wonClubvisions: { select: { id: true } },
      clubvisionResults: { select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return books;
}

function printBook(book: Awaited<ReturnType<typeof findDuplicates>>[number]) {
  console.log(`  [${book.id}] "${book.title}"`);
  console.log(`    Autor: ${book.author?.name ?? '(sin autor)'}`);
  console.log(`    ISBN: ${book.isbn ?? '(sin ISBN)'}`);
  console.log(`    canonicalKey: ${book.canonicalKey}`);
  console.log(`    Biblioteca: ${book.library.map((l) => l.user.name).join(', ') || 'nadie'}`);
  console.log(`    Wishlist: ${book.wishlistItems.map((w) => w.user.name).join(', ') || 'nadie'}`);
  console.log(`    Reseñas: ${book.reviews.length}, Lecturas: ${book.readings.length}`);
  console.log(`    Fuentes: ${book.sources.map((s) => s.source).join(' | ') || '(ninguna)'}`);
}

async function mergeBooks(
  keepId: string,
  deleteId: string,
  canonicalTitle: string,
) {
  const [keep, del] = await Promise.all([
    prisma.book.findUnique({
      where: { id: keepId },
      include: {
        library: { select: { userId: true } },
        reviews: { select: { userId: true } },
        wishlistItems: { select: { userId: true } },
      },
    }),
    prisma.book.findUnique({
      where: { id: deleteId },
      include: {
        library: { select: { userId: true } },
        reviews: { select: { userId: true } },
        wishlistItems: { select: { userId: true } },
      },
    }),
  ]);

  if (!keep) throw new Error(`Libro a mantener no existe: ${keepId}`);
  if (!del) throw new Error(`Libro duplicado no existe: ${deleteId}`);

  // Verificar conflictos: misma usuaria con ambos libros en biblioteca
  const keepLib = new Set(keep.library.map((l) => l.userId));
  const delLib = del.library.filter((l) => keepLib.has(l.userId));
  if (delLib.length > 0) {
    throw new Error(
      `Conflicto biblioteca: usuarias con ambos libros → ${delLib.map((l) => l.userId).join(', ')}`,
    );
  }

  // Verificar conflictos: misma usuaria con reseña en ambos
  const keepRev = new Set(keep.reviews.map((r) => r.userId));
  const delRev = del.reviews.filter((r) => keepRev.has(r.userId));
  if (delRev.length > 0) {
    throw new Error(
      `Conflicto reseñas: usuarias con reseña en ambos → ${delRev.map((r) => r.userId).join(', ')}`,
    );
  }

  // Wishlist: si una usuaria tiene ambos, borramos el del duplicado para no violar unique
  const keepWish = new Set(keep.wishlistItems.map((w) => w.userId));
  const wishConflicts = del.wishlistItems.filter((w) => keepWish.has(w.userId));

  console.log(`\n  🚚 Fusionando "${del.title}" → "${keep.title}" (título final: "${canonicalTitle}")`);

  const result = await prisma.$transaction(async (tx) => {
    // Si hay wishlist duplicadas para la misma usuaria, borrar la del duplicado
    if (wishConflicts.length > 0) {
      console.log(`    ⚠️  Borrando ${wishConflicts.length} entradas de wishlist duplicadas`);
      await tx.wishlistItem.deleteMany({
        where: { bookId: deleteId, userId: { in: wishConflicts.map((w) => w.userId) } },
      });
    }

    const wishlist = await tx.wishlistItem.updateMany({
      where: { bookId: deleteId },
      data: { bookId: keepId },
    });

    const bibliotecas = await tx.library.updateMany({
      where: { bookId: deleteId },
      data: { bookId: keepId },
    });

    const resenas = await tx.review.updateMany({
      where: { bookId: deleteId },
      data: { bookId: keepId },
    });

    const lecturas = await tx.reading.updateMany({
      where: { bookId: deleteId },
      data: { bookId: keepId },
    });

    const candidaturas = await tx.clubvisionCandidate.updateMany({
      where: { bookId: deleteId },
      data: { bookId: keepId },
    });

    const clubvisionsGanadas = await tx.clubvision.updateMany({
      where: { winnerBookId: deleteId },
      data: { winnerBookId: keepId },
    });

    const resultadosClubvision = await tx.clubvisionResult.updateMany({
      where: { winnerBookId: deleteId },
      data: { winnerBookId: keepId },
    });

    // Mover BookSource del duplicado al canónico (si no hay conflicto de clave única)
    const sourcesDel = await tx.bookSource.findMany({ where: { bookId: deleteId } });
    const sourcesKeep = await tx.bookSource.findMany({ where: { bookId: keepId }, select: { source: true, sourceUrl: true } });
    const keepSourceKeys = new Set(sourcesKeep.map((s) => `${s.source}|${s.sourceUrl}`));
    for (const src of sourcesDel) {
      const key = `${src.source}|${src.sourceUrl}`;
      if (keepSourceKeys.has(key)) {
        await tx.bookSource.delete({ where: { id: src.id } });
      } else {
        await tx.bookSource.update({ where: { id: src.id }, data: { bookId: keepId } });
      }
    }

    // Crear redirect para que bookIds viejos sigan funcionando
    await tx.bookRedirect.upsert({
      where: { oldBookId: deleteId },
      update: { canonicalBookId: keepId },
      create: { oldBookId: deleteId, canonicalBookId: keepId },
    });

    // Actualizar el libro canónico con los mejores datos disponibles
    const libroActualizado = await tx.book.update({
      where: { id: keepId },
      data: {
        title: canonicalTitle,
        coverUrl: keep.coverUrl?.trim() || del.coverUrl?.trim() || undefined,
        isbn: keep.isbn?.trim() || del.isbn?.trim() || undefined,
        normalizedIsbn: keep.normalizedIsbn?.trim() || del.normalizedIsbn?.trim() || undefined,
        synopsis: keep.synopsis?.trim() || del.synopsis?.trim() || undefined,
        goodreadsUrl: keep.goodreadsUrl?.trim() || del.goodreadsUrl?.trim() || undefined,
        authorId: keep.authorId ?? del.authorId,
        seriesId: keep.seriesId ?? del.seriesId,
        seriesOrder: keep.seriesOrder?.trim() || del.seriesOrder?.trim() || undefined,
        publicationYear: keep.publicationYear ?? del.publicationYear,
      },
    });

    // Borrar el duplicado
    await tx.book.delete({ where: { id: deleteId } });

    return {
      libroActualizado,
      wishlistMovidas: wishlist.count,
      bibliotecasMovidas: bibliotecas.count,
      resenasMovidas: resenas.count,
      lecturasMovidas: lecturas.count,
      candidaturasMovidas: candidaturas.count,
    };
  });

  console.log(`    ✅ Wishlist movidas: ${result.wishlistMovidas}`);
  console.log(`    ✅ Bibliotecas movidas: ${result.bibliotecasMovidas}`);
  console.log(`    ✅ Reseñas movidas: ${result.resenasMovidas}`);
  console.log(`    ✅ Lecturas movidas: ${result.lecturasMovidas}`);
  console.log(`    ✅ Candidaturas movidas: ${result.candidaturasMovidas}`);
  console.log(`    ✅ Redirect creado: ${deleteId} → ${keepId}`);
  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Inspección previa ─────────────────────────────────────────────────────

  console.log('═══════════════════════════════════════════════════════════');
  console.log(' INSPECCIÓN PREVIA DE DUPLICADOS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const zodiacBooks = await findDuplicates('Zodiac Academy 1');
  console.log(`📚 "Zodiac Academy 1" — ${zodiacBooks.length} registros encontrados:`);
  for (const b of zodiacBooks) printBook(b);

  const taipeiBooks = await findDuplicates('historia de Taipei');
  console.log(`\n📚 "Una historia de Taipei" — ${taipeiBooks.length} registros encontrados:`);
  for (const b of taipeiBooks) printBook(b);

  // Validar que encontramos exactamente 2 de cada uno
  if (zodiacBooks.length < 2) {
    console.log('\n⚠️  Zodiac Academy 1: ya hay un solo registro, no hace falta fusionar.');
  }
  if (taipeiBooks.length < 2) {
    console.log('\n⚠️  Una historia de Taipei: ya hay un solo registro, no hace falta fusionar.');
  }
  if (zodiacBooks.length < 2 && taipeiBooks.length < 2) {
    console.log('\n✅ Nada que fusionar. La BD ya está limpia.');
    return;
  }

  // ── 2. Fusión ────────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' INICIANDO FUSIÓN');
  console.log('═══════════════════════════════════════════════════════════');

  // Para cada par: el libro más antiguo (índice 0) es el canónico; el más nuevo el duplicado.
  // Elegimos el título más limpio como canónico final.

  if (zodiacBooks.length >= 2) {
    // El canónico es el que ya está en las bibliotecas/wishlist de las usuarias.
    // Ordenados por createdAt ASC → el primero suele ser el más referenciado.
    // Dejamos que el script elija el que tiene más entradas de biblioteca.
    const [a, b] = zodiacBooks;
    const keepZodiac = (a!.library.length >= b!.library.length) ? a! : b!;
    const deleteZodiac = keepZodiac === a ? b! : a!;
    await mergeBooks(
      keepZodiac.id,
      deleteZodiac.id,
      'Zodiac Academy 1: El despertar',
    );
  }

  if (taipeiBooks.length >= 2) {
    const [a, b] = taipeiBooks;
    const keepTaipei = (a!.library.length >= b!.library.length) ? a! : b!;
    const deleteTaipei = keepTaipei === a ? b! : a!;
    await mergeBooks(
      keepTaipei.id,
      deleteTaipei.id,
      'Una historia de Taipei',
    );
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' ✅ FUSIÓN COMPLETADA');
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .catch((error) => {
    console.error('\n❌ Error durante la fusión:');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
