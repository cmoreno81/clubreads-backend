import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseUpcomingJsonLd } from '../src/services/upcoming-release-sync.service.js';

test('extracts future releases with their editorial metadata and ignores past books', () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Book",
            "name": "La novela futura",
            "author": { "@type": "Person", "name": "Autora Ejemplo" },
            "datePublished": "2099-09-14",
            "publisher": { "@type": "Organization", "name": "Editorial ClubReads" },
            "genre": "Fantasía",
            "image": "https://example.com/futura.jpg",
            "isbn": "9781234567890",
            "url": "https://example.com/futura"
          },
          {
            "@type": "Book",
            "name": "La novela antigua",
            "datePublished": "2020-01-01"
          }
        ]
      }
    </script>
  `;

  const books = parseUpcomingJsonLd(
    html,
    'fnac',
    'https://example.com',
    new Date('2090-01-01'),
  );

  assert.equal(books.length, 1);
  assert.equal(books[0]?.title, 'La novela futura');
  assert.equal(books[0]?.author, 'Autora Ejemplo');
  assert.equal(books[0]?.publisher, 'Editorial ClubReads');
  assert.equal(books[0]?.genre, 'Fantasía');
  assert.equal(books[0]?.isbn, '9781234567890');
  assert.equal(books[0]?.source, 'fnac');
});

test('upcoming endpoint exposes wishlist and library state without coupling both relations', async () => {
  const service = await readFile(
    new URL('../src/services/upcoming-releases.service.ts', import.meta.url),
    'utf8',
  );
  const wishlist = await readFile(
    new URL('../src/services/wishlist.service.ts', import.meta.url),
    'utf8',
  );

  assert.match(service, /isInWishlist/);
  assert.match(service, /isInLibrary/);
  assert.match(service, /publicationDate:\s*\{[\s\S]*gte:/);
  assert.match(wishlist, /alreadyExists:\s*true/);
  assert.match(wishlist, /isInLibrary/);
  assert.doesNotMatch(service, /deleteMany[\s\S]*wishlist/i);
});
