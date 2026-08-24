import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  extractCasaDelLibroProductUrls,
  parseCasaDelLibroDetail,
  parseGoogleBooksUpcoming,
  parseUpcomingFeed,
  parseUpcomingJsonLd,
} from "../src/services/upcoming-release-sync.service.js";

test("extracts Casa del Libro product links and their future metadata", () => {
  const urls = extractCasaDelLibroProductUrls(
    '<a href="/libro-una-historia/9791388204081/18283618">Libro</a>',
    "https://www.casadellibro.com/proximos-lanzamientos-en-libros",
  );
  assert.deepEqual(urls, [
    "https://www.casadellibro.com/libro-una-historia/9791388204081/18283618",
  ]);

  const book = parseCasaDelLibroDetail(
    `<meta content="https://example.com/cover.jpg" property="og:image">
     <meta content="Una historia | R.F. Kuang | Editorial Hidra | Casa del Libro" property="og:title">
     <meta content="9791388204081" property="book:isbn">
     <meta content="R.F. Kuang" property="book:author">
     <meta content="2099-09-14" property="book:release_date">`,
    "Casa del Libro",
    urls[0]!,
    new Date("2090-01-01"),
  );
  assert.equal(book?.title, "Una historia");
  assert.equal(book?.author, "R.F. Kuang");
  assert.equal(book?.publisher, "Hidra");
  assert.equal(book?.isbn, "9791388204081");
  assert.equal(book?.coverUrl, "https://example.com/cover.jpg");
});

test("extracts future releases with their editorial metadata and ignores past books", () => {
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
    "fnac",
    "https://example.com",
    new Date("2090-01-01"),
  );

  assert.equal(books.length, 1);
  assert.equal(books[0]?.title, "La novela futura");
  assert.equal(books[0]?.author, "Autora Ejemplo");
  assert.equal(books[0]?.publisher, "Editorial ClubReads");
  assert.equal(books[0]?.genre, "Fantasía");
  assert.equal(books[0]?.isbn, "9781234567890");
  assert.equal(books[0]?.source, "fnac");
});

test("Google Books keeps only future books with a complete publication date", () => {
  const books = parseGoogleBooksUpcoming(
    {
      items: [
        {
          id: "future-id",
          volumeInfo: {
            title: "Futura edición",
            authors: ["Autora Ejemplo"],
            publishedDate: "2099-10-02",
            publisher: "Editorial",
            categories: ["Fantasía"],
            imageLinks: { thumbnail: "http://example.com/cover.jpg" },
            industryIdentifiers: [
              { type: "ISBN_13", identifier: "9781234567890" },
            ],
          },
        },
        {
          id: "partial-date",
          volumeInfo: { title: "Sin día fiable", publishedDate: "2099" },
        },
      ],
    },
    new Date("2090-01-01"),
  );

  assert.equal(books.length, 1);
  assert.equal(books[0]?.source, "Google Books");
  assert.equal(books[0]?.coverUrl, "https://example.com/cover.jpg");
});

test("authorized feed keeps future items and ignores past ones", () => {
  const books = parseUpcomingFeed(
    {
      items: [
        {
          title: "Próximo libro",
          author: "Autora",
          isbn: "9781234567890",
          publicationDate: "2099-02-12",
          coverUrl: "https://example.com/cover.jpg",
          sourceUrl: "https://example.com/book",
        },
        { title: "Libro antiguo", publicationDate: "2025-01-01" },
      ],
    },
    "Editorial",
    "https://example.com/feed.json",
    new Date("2090-01-01"),
  );

  assert.equal(books.length, 1);
  assert.equal(books[0]?.title, "Próximo libro");
  assert.equal(books[0]?.source, "Editorial");
});

test("upcoming endpoint exposes wishlist and library state without coupling both relations", async () => {
  const service = await readFile(
    new URL("../src/services/upcoming-releases.service.ts", import.meta.url),
    "utf8",
  );
  const wishlist = await readFile(
    new URL("../src/services/wishlist.service.ts", import.meta.url),
    "utf8",
  );

  assert.match(service, /isInWishlist/);
  assert.match(service, /isInLibrary/);
  assert.match(service, /publicationDate:\s*\{[\s\S]*gte:/);
  assert.match(wishlist, /alreadyExists:\s*true/);
  assert.match(wishlist, /isInLibrary/);
  assert.doesNotMatch(service, /deleteMany[\s\S]*wishlist/i);
});
