import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function main() {
  const total = await prisma.book.count({ where: { deletedAt: null } });
  const sinIdioma = await prisma.book.count({ where: { deletedAt: null, language: null } });
  console.log('Total libros activos:', total);
  console.log('Sin idioma:', sinIdioma, `(${((sinIdioma / total) * 100).toFixed(1)}%)`);

  // También cuántos libros GUARDADOS en bibliotecas (Library) están sin idioma,
  // que es el dato relevante para el gráfico de "Cómo lee la comunidad".
  const librosGuardados = await prisma.library.count();
  const librosGuardadosSinIdioma = await prisma.library.count({
    where: { book: { language: null } },
  });
  console.log('\nEntradas de biblioteca (Library) totales:', librosGuardados);
  console.log('Entradas de biblioteca sin idioma:', librosGuardadosSinIdioma, `(${((librosGuardadosSinIdioma / librosGuardados) * 100).toFixed(1)}%)`);
}
main().finally(() => prisma.$disconnect());
