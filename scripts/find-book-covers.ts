import 'dotenv/config';

import { prisma } from '../src/prisma.js';
import {
  findBestBookCover,
  type BookCoverCandidate,
} from '../src/services/book-cover.service.js';

const applyChanges =
  process.argv.includes('--apply');

const includeExisting =
  process.argv.includes('--all');

const delayMs = 250;

type CoverReport = {
  bookId: string;
  currentTitle: string;
  status:
    | 'SAFE'
    | 'AMBIGUOUS'
    | 'NOT_FOUND'
    | 'ERROR';
  selected: BookCoverCandidate | null;
  alternatives: BookCoverCandidate[];
  applied: boolean;
  error?: string;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function main() {
  console.log(
    applyChanges
      ? '🚀 MODO APPLY: se guardarán coincidencias seguras'
      : '🔎 MODO PREVIEW: no se modificará la base de datos',
  );

  const books = await prisma.book.findMany({
    where: {
      deletedAt: null,

      ...(includeExisting
        ? {}
        : {
            OR: [
              { coverUrl: null },
              { coverUrl: '' },
            ],
          }),
    },

    select: {
      id: true,
      title: true,
      coverUrl: true,
      isbn: true,
      publicationYear: true,
      authorId: true,
    },

    orderBy: {
      title: 'asc',
    },
  });

  console.log(
    `📚 ${books.length} libros para revisar\n`,
  );

  const report: CoverReport[] = [];

  let safe = 0;
  let ambiguous = 0;
  let notFound = 0;
  let errors = 0;
  let applied = 0;

  for (
    let index = 0;
    index < books.length;
    index += 1
  ) {
    const book = books[index];

    console.log(
      `[${index + 1}/${books.length}] ${book.title}`,
    );

    try {
      const match =
        await findBestBookCover(book.title);

      if (!match.candidate) {
        notFound += 1;

        report.push({
          bookId: book.id,
          currentTitle: book.title,
          status: 'NOT_FOUND',
          selected: null,
          alternatives: [],
          applied: false,
        });

        console.log('   ❌ Sin portada\n');

        await wait(delayMs);
        continue;
      }

      if (!match.safeToApply) {
        ambiguous += 1;

        report.push({
          bookId: book.id,
          currentTitle: book.title,
          status: 'AMBIGUOUS',
          selected: match.candidate,
          alternatives: match.alternatives,
          applied: false,
        });

        console.log(
          `   ⚠️ Dudosa: "${match.candidate.title}"`,
        );
        console.log(
          `   Puntuación: ${match.candidate.score}`,
        );
        console.log(
          `   Autoría: ${
            match.candidate.authors.join(', ') ||
            'sin autor'
          }\n`,
        );

        await wait(delayMs);
        continue;
      }

      safe += 1;

      let wasApplied = false;

      if (applyChanges) {
        const candidate = match.candidate;

        await prisma.$transaction(
          async (tx) => {
            let authorId = book.authorId;

            /*
             * Solo creamos autor si el libro todavía
             * no tenía uno y Google devuelve exactamente uno.
             */
            if (
              !authorId &&
              candidate.authors.length === 1
            ) {
              const author =
                await tx.author.upsert({
                  where: {
                    name: candidate.authors[0],
                  },
                  update: {},
                  create: {
                    name: candidate.authors[0],
                  },
                });

              authorId = author.id;
            }

            await tx.book.update({
              where: {
                id: book.id,
              },
              data: {
                coverUrl:
                  candidate.coverUrl,

                /*
                 * No sobrescribimos metadatos existentes.
                 */
                isbn:
                  book.isbn ??
                  candidate.isbn,

                publicationYear:
                  book.publicationYear ??
                  candidate.publicationYear,

                authorId:
                  book.authorId ??
                  authorId,
              },
            });
          },
        );

        wasApplied = true;
        applied += 1;
      }

      report.push({
        bookId: book.id,
        currentTitle: book.title,
        status: 'SAFE',
        selected: match.candidate,
        alternatives: match.alternatives,
        applied: wasApplied,
      });

      console.log(
        `   ✅ ${match.candidate.title}`,
      );
      console.log(
        `   👤 ${
          match.candidate.authors.join(', ') ||
          'sin autor'
        }`,
      );
      console.log(
        `   🖼️ ${match.candidate.coverUrl}`,
      );
      console.log(
        applyChanges
          ? '   💾 Guardada\n'
          : '   👀 Solo previsualización\n',
      );
    } catch (error) {
      errors += 1;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      report.push({
        bookId: book.id,
        currentTitle: book.title,
        status: 'ERROR',
        selected: null,
        alternatives: [],
        applied: false,
        error: message,
      });

      console.error(`   💥 ${message}\n`);
    }

    await wait(delayMs);
  }

  /*
   * Dejamos el informe en JSON para poder revisar
   * las coincidencias dudosas con calma.
   */
  const { mkdir, writeFile } = await import(
    'node:fs/promises'
  );

  await mkdir('reports', {
    recursive: true,
  });

  const reportPath =
    applyChanges
      ? 'reports/book-covers-apply.json'
      : 'reports/book-covers-preview.json';

  await writeFile(
    reportPath,
    JSON.stringify(report, null, 2),
    'utf8',
  );

  console.log('────────────────────────────');
  console.log(`✅ Seguras: ${safe}`);
  console.log(`⚠️ Dudosas: ${ambiguous}`);
  console.log(`❌ Sin resultado: ${notFound}`);
  console.log(`💥 Errores: ${errors}`);
  console.log(`💾 Guardadas: ${applied}`);
  console.log(`📄 Informe: ${reportPath}`);
  console.log('────────────────────────────');

  if (!applyChanges) {
    console.log(
      '\nNada se ha modificado. Revisa el informe antes de ejecutar --apply.',
    );
  }
}

main()
  .catch((error) => {
    console.error(
      'Error general del script:',
      error,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });