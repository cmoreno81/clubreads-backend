type OpenLibraryDocument = {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  language?: string[];
  cover_i?: number;
  cover_edition_key?: string;
  edition_key?: string[];
};

type OpenLibrarySearchResponse = {
  numFound?: number;
  numFoundExact?: boolean;
  docs?: OpenLibraryDocument[];
};

export type BookCoverCandidate = {
  source: 'OPEN_LIBRARY';
  externalId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  coverUrl: string;
  isbn: string | null;
  publicationYear: number | null;
  language: string | null;
  score: number;
  exactTitle: boolean;
};

export type BookCoverMatch = {
  candidate: BookCoverCandidate | null;
  alternatives: BookCoverCandidate[];
  safeToApply: boolean;
};

const OPEN_LIBRARY_SEARCH_URL =
  'https://openlibrary.org/search.json';

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”"'’`´:;,.!?¿¡()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleWithoutArticle(value: string) {
  return normalizeText(value).replace(
    /^(el|la|los|las|un|una|unos|unas|the|a|an)\s+/,
    '',
  );
}

function calculateScore(
  searchedTitle: string,
  resultTitle: string,
) {
  const searched = normalizeText(searchedTitle);
  const result = normalizeText(resultTitle);

  if (!searched || !result) {
    return 0;
  }

  if (searched === result) {
    return 100;
  }

  if (
    titleWithoutArticle(searched) ===
    titleWithoutArticle(result)
  ) {
    return 96;
  }

  if (
    result.startsWith(`${searched} `) ||
    searched.startsWith(`${result} `)
  ) {
    return 84;
  }

  if (
    result.includes(searched) ||
    searched.includes(result)
  ) {
    return 74;
  }

  const searchedWords = new Set(
    searched.split(' '),
  );

  const resultWords = new Set(
    result.split(' '),
  );

  const commonWords = [...searchedWords].filter(
    (word) => resultWords.has(word),
  ).length;

  const maxWords = Math.max(
    searchedWords.size,
    resultWords.size,
  );

  if (maxWords === 0) {
    return 0;
  }

  return Math.round(
    (commonWords / maxWords) * 65,
  );
}

function selectIsbn(isbns?: string[]) {
  if (!Array.isArray(isbns)) {
    return null;
  }

  const isbn13 = isbns.find(
    (isbn) => isbn.trim().length === 13,
  );

  if (isbn13) {
    return isbn13.trim();
  }

  const isbn10 = isbns.find(
    (isbn) => isbn.trim().length === 10,
  );

  return isbn10?.trim() ?? null;
}

function buildCoverUrl(coverId?: number) {
  if (!coverId) {
    return null;
  }

  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
}

function buildCandidate(
  searchedTitle: string,
  document: OpenLibraryDocument,
): BookCoverCandidate | null {
  const title = document.title?.trim();
  const coverUrl = buildCoverUrl(
    document.cover_i,
  );

  if (!title || !coverUrl) {
    return null;
  }

  const score = calculateScore(
    searchedTitle,
    title,
  );

  const externalId =
    document.key?.replace('/works/', '') ||
    document.cover_edition_key ||
    document.edition_key?.[0] ||
    String(document.cover_i);

  return {
    source: 'OPEN_LIBRARY',
    externalId,
    title,
    subtitle:
      document.subtitle?.trim() || null,
    authors: Array.isArray(
      document.author_name,
    )
      ? document.author_name
          .map((author) => author.trim())
          .filter(Boolean)
      : [],
    coverUrl,
    isbn: selectIsbn(document.isbn),
    publicationYear:
      document.first_publish_year ?? null,
    language:
      document.language?.includes('spa')
        ? 'es'
        : document.language?.[0] ?? null,
    score,
    exactTitle:
      normalizeText(searchedTitle) ===
      normalizeText(title),
  };
}

async function searchOpenLibrary(
  title: string,
): Promise<BookCoverCandidate[]> {
  const params = new URLSearchParams({
    title,
    limit: '20',
    fields: [
      'key',
      'title',
      'subtitle',
      'author_name',
      'first_publish_year',
      'isbn',
      'language',
      'cover_i',
      'cover_edition_key',
      'edition_key',
    ].join(','),
  });

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 12_000);

  try {
    const response = await fetch(
      `${OPEN_LIBRARY_SEARCH_URL}?${params.toString()}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'ClubReads/1.0 (book-cover-import)',
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `OPEN_LIBRARY_HTTP_${response.status}`,
      );
    }

    const json =
      (await response.json()) as OpenLibrarySearchResponse;

    return (json.docs ?? [])
      .map((document) =>
        buildCandidate(title, document),
      )
      .filter(
        (
          candidate,
        ): candidate is BookCoverCandidate =>
          candidate !== null,
      );
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchBookCoverCandidates(
  title: string,
): Promise<BookCoverCandidate[]> {
  const cleanedTitle = title
    .trim()
    .replace(/\s+/g, ' ');

  if (!cleanedTitle) {
    return [];
  }

  const candidates =
    await searchOpenLibrary(cleanedTitle);

  return candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const aSpanish =
      a.language === 'es' ? 1 : 0;

    const bSpanish =
      b.language === 'es' ? 1 : 0;

    if (bSpanish !== aSpanish) {
      return bSpanish - aSpanish;
    }

    const aIsbn = a.isbn ? 1 : 0;
    const bIsbn = b.isbn ? 1 : 0;

    if (bIsbn !== aIsbn) {
      return bIsbn - aIsbn;
    }

    return b.authors.length -
      a.authors.length;
  });
}

export async function findBestBookCover(
  title: string,
): Promise<BookCoverMatch> {
  const candidates =
    await searchBookCoverCandidates(title);

  const candidate =
    candidates[0] ?? null;

  const secondCandidate =
    candidates[1] ?? null;

  const ambiguous =
    candidate !== null &&
    secondCandidate !== null &&
    candidate.score -
        secondCandidate.score <=
      2 &&
    normalizeText(candidate.title) !==
      normalizeText(secondCandidate.title);

  const safeToApply =
    candidate !== null &&
    candidate.score >= 96 &&
    !ambiguous;

  return {
    candidate,
    alternatives:
      candidates.slice(0, 5),
    safeToApply,
  };
}