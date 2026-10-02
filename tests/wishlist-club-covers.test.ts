import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/services/wishlist.service.ts', import.meta.url),
  'utf8',
);

test('la wishlist del club recupera la portada del catálogo vinculado', () => {
  assert.match(source, /book:\s*\{[\s\S]*coverUrl:\s*true/);
  assert.match(
    source,
    /item\.coverUrl\?\.trim\(\)\s*\|\|\s*item\.book\?\.coverUrl\?\.trim\(\)/,
  );
  assert.match(
    source,
    /const recoveredItems = await Promise\.all\(allItems\.map\(recoverCatalogBook\)\)/,
  );
  assert.match(source, /for \(const item of recoveredItems\)/);
});

test('la wishlist personal también completa portada y autora desde el catálogo', () => {
  assert.match(
    source,
    /coverUrl:\s*item\.coverUrl\?\.trim\(\)\s*\|\|\s*item\.book\?\.coverUrl\?\.trim\(\)/,
  );
  assert.match(
    source,
    /author:\s*item\.author\?\.trim\(\)\s*\|\|\s*item\.book\?\.author\?\.name\.trim\(\)/,
  );
  assert.match(
    source,
    /title:\s*\{ equals: item\.title\.trim\(\), mode: 'insensitive' \}/,
  );
});

test('la wishlist pública muestra solo compras todavía pendientes', () => {
  assert.match(
    source,
    /userId:\s*\{\s*in:\s*memberUserIds\s*\},\s*purchasedAt:\s*null/,
  );
});

test('la wishlist del club identifica los libros de la persona conectada', () => {
  assert.match(source, /const \{ club, user \} = await getCurrentClubContext/);
  assert.match(
    source,
    /isInMyWishlist:\s*\n\s*item\.userId === user\?\.id \|\|/,
  );
  assert.match(
    source,
    /item\.userId === user\?\.id \|\|[\s\S]*?\) \{\s*\n\s*existing\.isInMyWishlist = true;/,
  );
});

test('la wishlist del club no vuelve a ofrecer libros que la usuaria ya compró', () => {
  assert.match(
    source,
    /myPurchasedItems = user\s*\n\s*\? await prisma\.wishlistItem\.findMany\(\{\s*\n\s*where: \{ userId: user\.id, purchasedAt: \{ not: null \} \}/,
  );
  assert.match(
    source,
    /myPurchasedKeys\.has\(item\.bookId\)/,
  );
  assert.match(
    source,
    /myPurchasedKeys\.has\(normalizeForComparison\(title\)\)/,
  );
});
