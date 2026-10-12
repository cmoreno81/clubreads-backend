import { prisma } from '../src/prisma.js';

/// Lista las fichas de Talento emergente (por defecto las pendientes).
///   npm run talento:listar            → pendientes
///   npm run talento:listar -- todas   → todas
async function main() {
  const todas = process.argv.includes('todas');
  const fichas = await prisma.emergingTalentSubmission.findMany({
    where: todas ? {} : { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });
  if (fichas.length === 0) {
    console.log(todas ? 'No hay fichas.' : 'No hay fichas pendientes.');
    return;
  }
  for (const f of fichas) {
    console.log(
      [
        `\n[${f.status}] ${f.title} — ${f.authorName}  (${f.createdAt.toISOString().slice(0, 10)})`,
        `  id: ${f.id}`,
        `  contacto: ${f.contactEmail}${f.authorProfile ? ` · ${f.authorProfile}` : ''}`,
        `  género: ${[f.genre, ...f.extraGenres].join(' · ')} · picante ${f.spicyLevel}/5 · ${f.language}${f.pages ? ` · ${f.pages} págs` : ''}`,
        `  tropos: ${f.tropes.join(', ') || '—'}`,
        `  enlace: ${f.buyUrl}`,
        `  portada: ${f.coverUrl}`,
        `  sinopsis: ${f.synopsis.slice(0, 160)}${f.synopsis.length > 160 ? '…' : ''}`,
        f.authorNote ? `  nota: ${f.authorNote.slice(0, 160)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
