import { prisma } from '../src/prisma.js';
import {
  aprobarFichaTalento,
  rechazarFichaTalento,
  retirarSelloTalento,
} from '../src/services/talento-emergente-aprobacion.service.js';
import { destacarEstaSemana } from '../src/services/talento-emergente-destacada.service.js';

/// Revisión de fichas de Talento emergente:
///   npm run talento:aprobar -- <idFicha>
///   npm run talento:rechazar -- <idFicha> "motivo"
///   npm run talento:retirar -- <idLibro>
///   npm run talento:destacar -- <idLibro>   (autora de la semana, esta semana)
async function main() {
  const [accion, id, ...resto] = process.argv.slice(2);
  if (!accion || !id) {
    console.error('Uso: talento-revisar <aprobar|rechazar|retirar> <id> [motivo]');
    process.exitCode = 1;
    return;
  }
  if (accion === 'aprobar') {
    const r = await aprobarFichaTalento(id);
    console.log(
      r.ok
        ? `Aprobada: «${r.titulo}» (${r.fusionado ? 'ya existía, se ha marcado' : 'libro nuevo'}) · id libro ${r.bookId}`
        : r.mensaje,
    );
    if (!r.ok) process.exitCode = 1;
  } else if (accion === 'rechazar') {
    const r = await rechazarFichaTalento(id, resto.join(' '));
    console.log(r.ok ? 'Ficha rechazada.' : r.mensaje);
    if (!r.ok) process.exitCode = 1;
  } else if (accion === 'retirar') {
    const r = await retirarSelloTalento(id);
    console.log(r.ok ? 'Sello retirado.' : r.mensaje);
    if (!r.ok) process.exitCode = 1;
  } else if (accion === 'destacar') {
    const r = await destacarEstaSemana(id);
    console.log(r.ok ? `«${r.titulo}» es la autora de la semana.` : r.mensaje);
    if (!r.ok) process.exitCode = 1;
  } else {
    console.error(`Acción desconocida: ${accion}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
