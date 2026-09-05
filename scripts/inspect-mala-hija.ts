import { prisma } from '../src/prisma.js';

async function main() {
  const books = await prisma.book.findMany({
    where: {
      OR: [
        { title: { contains: 'mala hija', mode: 'insensitive' } },
        { title: { contains: 'hija del cielo', mode: 'insensitive' } },
      ],
    },
    include: {
      author: { select: { name: true } },
      genre: { select: { name: true } },
      sources: { orderBy: { lastCheckedAt: 'desc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const b of books) {
    console.log(`\n📚 "${b.title}"`);
    console.log(`   ID: ${b.id}`);
    console.log(`   Autor: ${b.author?.name ?? '—'}`);
    console.log(`   Género: ${b.genre?.name ?? '—'}`);
    console.log(`   ISBN: ${b.isbn ?? '—'} (normalizado: ${b.normalizedIsbn ?? '—'})`);
    console.log(`   coverUrl: ${b.coverUrl ?? '—'}`);
    console.log(`   publicationDate: ${b.publicationDate?.toISOString() ?? '—'}`);
    console.log(`   publicationYear: ${b.publicationYear ?? '—'}`);
    console.log(`   canonicalKey: ${b.canonicalKey}`);
    console.log(`   deletedAt: ${b.deletedAt ?? 'null (activo)'}`);
    console.log(`   createdAt: ${b.createdAt.toISOString()} | updatedAt: ${b.updatedAt.toISOString()}`);
    console.log(`   BookSource (${b.sources.length}):`);
    for (const s of b.sources) {
      console.log(`     - ${s.source} → ${s.sourceUrl} (lastCheckedAt: ${s.lastCheckedAt?.toISOString() ?? '—'})`);
    }
  }

  if (books.length) {
    const ids = books.map((b) => b.id);
    const wishlist = await prisma.wishlistItem.findMany({
      where: { bookId: { in: ids } },
      select: { id: true, userId: true, bookId: true, title: true, isbn: true, releaseDate: true, purchasedAt: true },
    });
    console.log('\n--- WishlistItem ---');
    for (const w of wishlist) console.log(JSON.stringify(w));

    const library = await prisma.library.findMany({
      where: { bookId: { in: ids } },
      select: { userId: true, bookId: true },
    });
    console.log('\n--- Library (usuarias que lo tienen) ---');
    for (const l of library) console.log(JSON.stringify(l));
  }
}

main().finally(() => prisma.$disconnect());
