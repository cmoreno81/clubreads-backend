import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync('src/services/catalog.service.ts', 'utf8');

test('el catálogo global notifica las nuevas altas de biblioteca', () => {
  assert.match(catalog, /async function notifyLibraryAddition/);
  assert.match(
    catalog,
    /importCatalogBook[\s\S]*prisma\.library\.create[\s\S]*notifyLibraryAddition/,
  );
});

test('completar saga notifica solo si el libro no estaba en la biblioteca', () => {
  assert.match(
    catalog,
    /addSeriesCatalogVolume[\s\S]*const existingLibrary[\s\S]*if \(!existingLibrary\)[\s\S]*notifyLibraryAddition/,
  );
});
