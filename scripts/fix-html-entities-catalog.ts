/**
 * Migración: limpia entidades HTML en Book.title, Book.canonicalKey y Author.name.
 *
 * Algunos registros entraron en BD con "&amp;" u otras entidades HTML porque
 * el scraper de Casa del Libro no decodificaba el atributo og:title antes
 * de persistir. Este script los normaliza.
 *
 * Ejecutar: npx tsx scripts/fix-html-entities-catalog.ts
 */

import { prisma } from '../src/prisma.js';
import { cleanText } from '../src/utils/text.js';
import { canonicalBookKey } from '../src/services/book-identity.service.js';

async function main() {
  console.log('🔍 Revisando Book.title y Author.name con entidades HTML...\n');

  // ── Authors ──────────────────────────────────────────────────────────────────
  const authors = await prisma.author.findMany({ select: { id: true, name: true } });
  const authorsToFix = authors.filter((a) => cleanText(a.name) !== a.name);
  console.log(`📋 Authors a corregir: ${authorsToFix.length}`);
  for (const author of authorsToFix) {
    const newName = cleanText(author.name);
    console.log(`  • "${author.name}" → "${newName}"`);

    // Puede que ya exista un Author con el nombre limpio (creado manualmente)
    const existing = await prisma.author.findUnique({ where: { name: newName } });
    if (existing) {
      // Reasignar todos los libros del author sucio al limpio y borrar el sucio
      await prisma.book.updateMany({
        where: { authorId: author.id },
        data: { authorId: existing.id },
      });
      await prisma.author.delete({ where: { id: author.id } });
      console.log(`    → fusionado con author existente (${existing.id})`);
    } else {
      await prisma.author.update({ where: { id: author.id }, data: { name: newName } });
    }
  }

  // ── Books ─────────────────────────────────────────────────────────────────────
  const books = await prisma.book.findMany({
    select: { id: true, title: true, canonicalKey: true, author: { select: { name: true } } },
  });
  const booksToFix = books.filter((b) => cleanText(b.title) !== b.title);
  console.log(`\n📋 Books a corregir: ${booksToFix.length}`);
  for (const book of booksToFix) {
    const newTitle = cleanText(book.title);
    const newKey = canonicalBookKey(newTitle, book.author?.name ?? '');
    console.log(`  • "${book.title}" → "${newTitle}"`);
    await prisma.book.update({
      where: { id: book.id },
      data: { title: newTitle, canonicalKey: newKey },
    });
  }

  console.log(`\n✅ Listo. Authors: ${authorsToFix.length}, Books: ${booksToFix.length}`);
}

main()
  .catch((e) => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
