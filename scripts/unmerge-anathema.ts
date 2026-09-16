import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import { invalidatePrefix } from '../src/utils/simple-cache.js';

/**
 * Deshace la fusión de "Anathema" (inglés) dentro de "Anatema" (español),
 * a petición de la lectora que leía la edición en inglés: quiere mantener
 * su ficha, idioma, carátula y páginas tal cual, en vez de que la fusión
 * las sustituya por las de la edición española.
 *
 * La ficha origen de una fusión no se borra de verdad (mergeBooks solo le
 * pone deletedAt), así que deshacerla es: restaurarla, quitar el redirect,
 * y devolver a su bibliotecaria (Lily White) a esa ficha con su progreso
 * actual. Para que no pierda la conversación de la lectura conjunta que
 * el club ya tiene activa sobre "Anatema", se vinculan ambas fichas por
 * workId (la misma "ficha padre" que ahora soporta lectura conjunta
 * compartida entre ediciones separadas).
 */

const SOURCE_BOOK_ID = 'cmtoo0df4008d2cjz1dyzu9ad'; // Anathema (en)
const CANONICAL_BOOK_ID = 'cmsc8o1e900aw1yqup2iajybd'; // Anatema (es)
const READER_USER_ID = 'cmtk63mgo010v2cqnnxcnw0a7'; // Lily White

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.book.findUnique({ where: { id: SOURCE_BOOK_ID } });
    if (!source) throw new Error('No se encuentra la ficha origen (Anathema)');
    if (!source.deletedAt) {
      throw new Error('La ficha origen no está fusionada (deletedAt es null) — ¿ya se deshizo?');
    }

    const canonical = await tx.book.findUnique({ where: { id: CANONICAL_BOOK_ID } });
    if (!canonical) throw new Error('No se encuentra la ficha canónica (Anatema)');

    // 1) Restaurar la ficha "Anathema" tal cual estaba.
    await tx.book.update({
      where: { id: SOURCE_BOOK_ID },
      data: { deletedAt: null },
    });

    // 2) Quitar el redirect: "Anathema" vuelve a ser una ficha propia,
    //    no un alias de "Anatema".
    await tx.bookRedirect.deleteMany({ where: { oldBookId: SOURCE_BOOK_ID } });

    // 3) Mover de vuelta la biblioteca de la lectora inglesa, conservando
    //    su progreso actual (página, estado, formato...) tal cual está hoy.
    const libraryRow = await tx.library.findUnique({
      where: { userId_bookId: { userId: READER_USER_ID, bookId: CANONICAL_BOOK_ID } },
    });
    if (!libraryRow) {
      throw new Error('La lectora no tiene ficha en la canónica — ¿se movió ya?');
    }
    await tx.library.update({
      where: { id: libraryRow.id },
      data: {
        bookId: SOURCE_BOOK_ID,
        // Ya no hace falta: el idioma vuelve a coincidir con el de la ficha.
        personalLanguage: null,
      },
    });

    // 4) Vincular ambas fichas (ficha padre) para que la lectura conjunta
    //    activa sobre "Anatema" se vea también desde "Anathema".
    const workId = canonical.workId ?? source.workId ?? randomUUID();
    await tx.book.updateMany({
      where: { id: { in: [SOURCE_BOOK_ID, CANONICAL_BOOK_ID] } },
      data: { workId },
    });

    return { workId };
  });

  invalidatePrefix('libros:');
  invalidatePrefix('finalizados:');

  console.log('Fusión deshecha. workId compartido:', result.workId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
