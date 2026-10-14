// Retira un contenido denunciado (comentario de capítulo, comentario de progreso o reseña).
// Por defecto NO cambia nada: enseña lo que es y quién lo escribió. Con --ejecutar lo retira
// (borrado suave: deja de verse pero queda guardado con su fecha, por si hay que revisarlo).
//
//   DATABASE_URL=<la de producción> npx tsx scripts/moderar-contenido.ts --tipo comentarioProgreso --id <ID>
//   DATABASE_URL=<la de producción> npx tsx scripts/moderar-contenido.ts --tipo comentarioProgreso --id <ID> --ejecutar
//
// El tipo y el ID vienen en la descripción del ticket de la denuncia («Tipo: … · ID: …»).
// tipos: comentario | comentarioProgreso | resena
import 'dotenv/config';

import { prisma } from '../src/prisma.js';

function argumento(nombre: string) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tipo = argumento('tipo');
const id = argumento('id');
const ejecutar = process.argv.includes('--ejecutar');
if (!tipo || !id || !['comentario', 'comentarioProgreso', 'resena'].includes(tipo)) {
  throw new Error('Uso: --tipo comentario|comentarioProgreso|resena --id <ID> [--ejecutar]');
}

const host = (() => {
  try { return new URL(process.env.DATABASE_URL ?? '').host; } catch { return '(desconocido)'; }
})();
console.log(`Base de datos: ${host}\nModo: ${ejecutar ? 'RETIRAR' : 'solo ver (no se cambia nada)'}\n`);

async function cargar() {
  if (tipo === 'comentarioProgreso') {
    const c = await prisma.progressComment.findUnique({
      where: { id },
      select: { text: true, createdAt: true, deletedAt: true, user: { select: { name: true } }, library: { select: { user: { select: { name: true } }, book: { select: { title: true } } } } },
    });
    return c && { autor: c.user.name, texto: c.text, fecha: c.createdAt, retirado: c.deletedAt, contexto: `lectura de ${c.library.user.name} · «${c.library.book.title}»` };
  }
  if (tipo === 'comentario') {
    const c = await prisma.comment.findUnique({
      where: { id },
      select: { text: true, createdAt: true, deletedAt: true, user: { select: { name: true } }, conversation: { select: { title: true, reading: { select: { book: { select: { title: true } }, club: { select: { name: true } } } } } } },
    });
    return c && { autor: c.user.name, texto: c.text, fecha: c.createdAt, retirado: c.deletedAt, contexto: `club «${c.conversation.reading.club.name}» · «${c.conversation.reading.book.title}» · ${c.conversation.title}` };
  }
  const r = await prisma.review.findUnique({
    where: { id },
    select: { review: true, createdAt: true, deletedAt: true, user: { select: { name: true } }, book: { select: { title: true } } },
  });
  return r && { autor: r.user.name, texto: r.review ?? '(solo valoración)', fecha: r.createdAt, retirado: r.deletedAt, contexto: `reseña de «${r.book.title}»` };
}

const item = await cargar();
if (!item) {
  console.log('No existe ningún contenido con ese tipo e ID.');
} else {
  console.log(`Autoría: ${item.autor}\nCuándo: ${item.fecha.toISOString()}\nDónde: ${item.contexto}\nTexto: «${item.texto}»\nEstado: ${item.retirado ? 'YA RETIRADO el ' + item.retirado.toISOString() : 'visible'}\n`);
  if (!ejecutar) console.log('Para retirarlo, repite el comando con --ejecutar.');
  else if (item.retirado) console.log('Ya estaba retirado: no se hace nada.');
  else {
    const ahora = new Date();
    if (tipo === 'comentarioProgreso') await prisma.progressComment.update({ where: { id }, data: { deletedAt: ahora } });
    else if (tipo === 'comentario') await prisma.comment.update({ where: { id }, data: { deletedAt: ahora } });
    else await prisma.review.update({ where: { id }, data: { deletedAt: ahora } });
    console.log('Retirado. Ya no se ve para nadie.');
  }
}
await prisma.$disconnect();
