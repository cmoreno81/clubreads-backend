/**
 * Migración: limpia entidades HTML en títulos y autores de la wishlist.
 *
 * Problema: algunos ítems de WishlistItem tienen "&amp;" (y otras entidades
 * HTML) en los campos title/author porque se guardaron así desde la app.
 * Esto impedía agrupar correctamente en la vista del club ("Lo que quiere
 * el club"), apareciendo el mismo libro duplicado.
 *
 * Ejecutar: npx tsx scripts/fix-wishlist-html-entities.ts
 */

import { prisma } from '../src/prisma.js';

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&nbsp;', ' ');
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value).trim().replace(/\s+/g, ' ');
}

async function main() {
  console.log('🔍 Buscando ítems de wishlist con entidades HTML...\n');

  const allItems = await prisma.wishlistItem.findMany({
    select: { id: true, title: true, author: true },
  });

  const toFix = allItems.filter((item) => {
    const titleNeedsfix = cleanText(item.title) !== item.title;
    const authorNeedsFix = item.author != null && cleanText(item.author) !== item.author;
    return titleNeedsfix || authorNeedsFix;
  });

  if (toFix.length === 0) {
    console.log('✅ No hay ítems que corregir.');
    return;
  }

  console.log(`📋 ${toFix.length} ítem(s) a corregir:\n`);
  for (const item of toFix) {
    const newTitle = cleanText(item.title);
    const newAuthor = item.author ? cleanText(item.author) : null;
    console.log(`  • [${item.id}]`);
    if (newTitle !== item.title) console.log(`    title:  "${item.title}" → "${newTitle}"`);
    if (newAuthor !== item.author) console.log(`    author: "${item.author}" → "${newAuthor}"`);
  }

  console.log('\n⏳ Aplicando cambios...');

  let fixed = 0;
  for (const item of toFix) {
    const newTitle = cleanText(item.title);
    const newAuthor = item.author ? cleanText(item.author) : null;
    await prisma.wishlistItem.update({
      where: { id: item.id },
      data: {
        title: newTitle,
        author: newAuthor,
      },
    });
    fixed++;
  }

  console.log(`\n✅ ${fixed} ítem(s) corregidos correctamente.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
