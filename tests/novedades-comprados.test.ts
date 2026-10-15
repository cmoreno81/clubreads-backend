import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const f of ['new-releases', 'upcoming-releases']) {
  test(`${f}: un libro ya comprado desde la lista de deseos deja constancia (isPurchased)`, () => {
    const src = readFileSync(`src/services/${f}.service.ts`, 'utf8');
    assert.match(src, /purchasedAt: \{ not: null \}/);
    assert.match(src, /isPurchased:/);
    assert.match(src, /purchasedByBookId\.has\(book\.id\)/);
    assert.match(src, /purchasedByIsbn\.has\(book\.isbn\)/);
    assert.match(src, /purchasedByTitle\.has\(normalizeTitle\(book\.title\)\)/);
    // El deseo activo sigue siendo solo el no comprado.
    assert.match(src, /purchasedAt: null/);
  });
}
