import 'dotenv/config';

import { prisma } from '../src/prisma.js';
import { findBestBookCover } from '../src/services/book-cover.service.js';

const applyChanges = process.argv.includes('--apply');
const applyPreview = process.argv.includes('--apply-preview');
const applyReviewedCorrections = process.argv.includes('--apply-reviewed-corrections');
const missingOnly = process.argv.includes('--missing-only');
const delayMs = 250;

type AuthorReport = {
  bookId: string;
  title: string;
  status: 'SAFE' | 'AMBIGUOUS' | 'NOT_FOUND' | 'ERROR';
  author: string | null;
  applied: boolean;
  error?: string;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function main() {
  if (applyReviewedCorrections) {
    const corrections = [
      {
        bookId: 'cmrnr06as00240pqmm6q2ogwz',
        title: 'Cumbres borrascosas',
        author: 'Emily Brontë',
      },
      {
        bookId: 'cmrnzd740000l0pmghjb2y876',
        title: 'Perdiendo el control',
        author: 'Liz Tomforde',
      },
    ];

    for (const correction of corrections) {
      await prisma.$transaction(async (tx) => {
        const book = await tx.book.findUnique({
          where: { id: correction.bookId },
          select: { title: true },
        });
        if (!book || normalized(book.title) !== normalized(correction.title)) {
          throw new Error(
            `No se puede corregir ${correction.title}: el libro esperado no coincide`,
          );
        }
        const existing = await tx.author.findFirst({
          where: {
            name: {
              equals: correction.author,
              mode: 'insensitive',
            },
          },
        });
        const author = existing ?? await tx.author.create({
          data: { name: correction.author },
        });
        await tx.book.update({
          where: { id: correction.bookId },
          data: { authorId: author.id },
        });
      });
      console.log(`${correction.title}: ${correction.author}`);
    }
    return;
  }

  if (applyPreview) {
    const { readFile } = await import('node:fs/promises');
    const parsed = JSON.parse(
      await readFile('reports/book-authors-preview.json', 'utf8'),
    ) as AuthorReport[];
    const safe = parsed.filter(
      (item) => item.status === 'SAFE' && item.author?.trim(),
    );
    let applied = 0;

    for (const item of safe) {
      const authorName = item.author!.trim();
      await prisma.$transaction(async (tx) => {
        const existing = await tx.author.findFirst({
          where: {
            name: {
              equals: authorName,
              mode: 'insensitive',
            },
          },
        });
        const author = existing ?? await tx.author.create({
          data: { name: authorName },
        });
        const updated = await tx.book.updateMany({
          where: {
            id: item.bookId,
            authorId: null,
          },
          data: { authorId: author.id },
        });
        applied += updated.count;
      });
    }

    console.log(`Coincidencias seguras del informe: ${safe.length}`);
    console.log(`Autores guardados: ${applied}`);
    return;
  }

  const books = await prisma.book.findMany({
    where: {
      deletedAt: null,
      authorId: null,
    },
    select: {
      id: true,
      title: true,
    },
    orderBy: { title: 'asc' },
  });

  console.log(
    applyChanges
      ? `Actualizando autores de ${books.length} libros sin autor`
      : `Revisando ${books.length} libros sin modificar la base de datos`,
  );

  if (missingOnly) {
    for (const book of books) {
      console.log(`${book.id}\t${book.title}`);
    }
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir('reports', { recursive: true });
    await writeFile(
      'reports/books-missing-authors.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          total: books.length,
          books: books.map((book) => ({
            id: book.id,
            title: book.title,
          })),
        },
        null,
        2,
      ),
      'utf8',
    );
    const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    await writeFile(
      'reports/books-missing-authors.csv',
      [
        'Identificador,Título',
        ...books.map((book) => `${csvCell(book.id)},${csvCell(book.title)}`),
      ].join('\n'),
      'utf8',
    );
    console.log(`Total sin autor: ${books.length}`);
    console.log('Informe: reports/books-missing-authors.json');
    console.log('Listado manual: reports/books-missing-authors.csv');
    return;
  }

  const report: AuthorReport[] = [];

  for (let index = 0; index < books.length; index += 1) {
    const book = books[index];
    console.log(`[${index + 1}/${books.length}] ${book.title}`);

    try {
      const match = await findBestBookCover(book.title);
      const candidateTitle = normalized(match.candidate?.title ?? '');
      const candidateAuthor = normalized(match.candidate?.authors[0] ?? '');
      const hasCompetingAuthor = match.alternatives.some((candidate) =>
        candidate !== match.candidate &&
        normalized(candidate.title) === candidateTitle &&
        candidate.authors.length === 1 &&
        normalized(candidate.authors[0]) !== candidateAuthor
      );
      const authorName =
        match.safeToApply &&
          match.candidate?.authors.length === 1 &&
          !hasCompetingAuthor
          ? match.candidate.authors[0].trim()
          : '';

      if (!match.candidate) {
        report.push({
          bookId: book.id,
          title: book.title,
          status: 'NOT_FOUND',
          author: null,
          applied: false,
        });
      } else if (!authorName) {
        report.push({
          bookId: book.id,
          title: book.title,
          status: 'AMBIGUOUS',
          author: null,
          applied: false,
        });
      } else {
        let applied = false;
        if (applyChanges) {
          await prisma.$transaction(async (tx) => {
            const existing = await tx.author.findFirst({
              where: {
                name: {
                  equals: authorName,
                  mode: 'insensitive',
                },
              },
            });
            const author = existing ?? await tx.author.create({
              data: { name: authorName },
            });
            const updated = await tx.book.updateMany({
              where: {
                id: book.id,
                authorId: null,
              },
              data: { authorId: author.id },
            });
            applied = updated.count === 1;
          });
        }
        report.push({
          bookId: book.id,
          title: book.title,
          status: 'SAFE',
          author: authorName,
          applied,
        });
      }
    } catch (error) {
      report.push({
        bookId: book.id,
        title: book.title,
        status: 'ERROR',
        author: null,
        applied: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await wait(delayMs);
  }

  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir('reports', { recursive: true });
  const reportPath = applyChanges
    ? 'reports/book-authors-apply.json'
    : 'reports/book-authors-preview.json';
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const count = (status: AuthorReport['status']) =>
    report.filter((item) => item.status === status).length;
  console.log(`Seguras: ${count('SAFE')}`);
  console.log(`Dudosas: ${count('AMBIGUOUS')}`);
  console.log(`Sin resultado: ${count('NOT_FOUND')}`);
  console.log(`Errores: ${count('ERROR')}`);
  console.log(`Guardadas: ${report.filter((item) => item.applied).length}`);
  console.log(`Informe: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
