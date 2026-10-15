// Prueba de punta a punta de «¿quién lo ha leído?», afinidad, resumen semanal y «recomiéndame» sobre una base LOCAL VACÍA.
// DATABASE_URL=postgresql://postgres@localhost:PUERTO/NOMBRE npx tsx scripts/probar-descubrir-amigos-e2e.ts
const urlBase = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(urlBase)) throw new Error('Solo base local.');
import assert from 'node:assert/strict';
const R = '../src';
const { prisma } = await import(`${R}/prisma.js`);
const am = await import(`${R}/services/amistades.service.js`);
const d = await import(`${R}/services/amistades-descubrir.service.js`);
const sfx = Date.now();
const mk = (n: string) => prisma.user.create({ data: { name: `${n}${sfx}`, email: `${n}${sfx}@e.test` } });
const A = await mk('Ana'), B = await mk('Bea'), C = await mk('Cleo'), X = await mk('Extrana');
const gF = await prisma.genre.upsert({ where: { name: 'Fantasía' }, update: {}, create: { name: 'Fantasía' } });
const gR = await prisma.genre.upsert({ where: { name: 'Romance' }, update: {}, create: { name: 'Romance' } });
const libros = [];
for (let i = 0; i < 6; i++) libros.push(await prisma.book.create({ data: { title: `L${i}-${sfx}`, genreId: i < 4 ? gF.id : gR.id } }));
for (const [x, y] of [[A, B], [A, C]] as any) { await am.solicitarAmistad(x.id, { nombre: y.name }); await am.responderAmistad(y.id, x.name, true); }
const day = (n: number) => new Date(Date.now() - n * 86400000);
const termina = async (u: any, b: any, rating: number, dias: number, review?: string) => {
  await prisma.library.create({ data: { userId: u.id, bookId: b.id, status: 'FINISHED', startedAt: day(dias + 5), finishedAt: day(dias) } });
  await prisma.readingCompletion.create({ data: { userId: u.id, bookId: b.id, startedAt: day(dias + 5), finishedAt: day(dias), rating, trackedInApp: true } });
  await prisma.review.create({ data: { userId: u.id, bookId: b.id, rating, review } });
};
// Ana: L0..L3 · Bea: L0..L3 (notas parecidas) + L4 · Cleo: L0 + L5
for (let i = 0; i < 4; i++) { await termina(A, libros[i], 4, 20); await termina(B, libros[i], i % 2 ? 4 : 4.5, i + 1); }
await termina(B, libros[4], 5, 2);
await termina(C, libros[0], 2, 3); await termina(C, libros[5], 3, 4);
await prisma.library.create({ data: { userId: C.id, bookId: libros[1]!.id, status: 'READING', startedAt: day(1), lastProgress: 40 } });
await prisma.library.create({ data: { userId: B.id, bookId: libros[5]!.id, status: 'PENDING' } });

// ¿Quién lo ha leído?
let r: any = await d.getAmigosDelLibro(A.id, libros[0]!.id);
assert.deepEqual(r.items.map((i: any) => `${i.estado}:${i.nombre}`).sort(), [`TERMINADO:${B.name}`, `TERMINADO:${C.name}`].sort());
assert.equal(r.items.find((i: any) => i.nombre === B.name).valoracion, 4.5);
r = await d.getAmigosDelLibro(A.id, libros[1]!.id);
assert.ok(r.items.some((i: any) => i.estado === 'LEYENDO' && i.nombre === C.name && i.progreso === 40));
r = await d.getAmigosDelLibro(A.id, libros[5]!.id);
assert.ok(r.items.some((i: any) => i.estado === 'PENDIENTE' && i.nombre === B.name));
// Privacidad: Bea apaga biblioteca → no sale terminado ni pendiente; Cleo apaga «lo que leo» → no sale leyendo; Bea apaga reseñas → sin nota
await prisma.user.update({ where: { id: B.id }, data: { friendsSeeReviews: false } });
r = await d.getAmigosDelLibro(A.id, libros[0]!.id);
assert.equal(r.items.find((i: any) => i.nombre === B.name).valoracion, null);
await prisma.user.update({ where: { id: B.id }, data: { friendsSeeLibrary: false, friendsSeeReviews: true } });
r = await d.getAmigosDelLibro(A.id, libros[0]!.id);
assert.ok(!r.items.some((i: any) => i.nombre === B.name));
await prisma.user.update({ where: { id: C.id }, data: { friendsSeeReading: false } });
r = await d.getAmigosDelLibro(A.id, libros[1]!.id);
assert.equal(r.items.length, 0);
r = await d.getAmigosDelLibro(X.id, libros[0]!.id);
assert.equal(r.items.length, 0, 'sin amistades no sale nadie');
await prisma.user.update({ where: { id: B.id }, data: { friendsSeeLibrary: true } });
await prisma.user.update({ where: { id: C.id }, data: { friendsSeeReading: true } });

// Afinidad
r = await d.getAfinidadAmigos(A.id);
assert.equal(r.items[0].nombre, B.name);
assert.equal(r.items[0].enComun, 4);
assert.equal(r.items[0].afinidad, 100);
assert.deepEqual(r.items[0].generos, ['Fantasía']);
assert.equal(r.items[0].notasParecidas, true);
assert.equal(r.items[1].nombre, C.name); assert.equal(r.items[1].enComun, 1);
const puro = d.calcularAfinidad([], []);
assert.deepEqual(puro, { enComun: 0, afinidad: 0, generos: [], notasParecidas: false });
await prisma.user.update({ where: { id: B.id }, data: { friendsSeeLibrary: false } });
r = await d.getAfinidadAmigos(A.id);
assert.ok(!r.items.some((i: any) => i.nombre === B.name), 'quien no comparte su biblioteca no sale');
await prisma.user.update({ where: { id: B.id }, data: { friendsSeeLibrary: true } });

// Resumen semanal: Bea 4 en 7 días (L0..L3 con dias 1..4) + L4 (2) = 5; Cleo 2 (3 y 4) → 7 terminados, 2 personas; libro más leído L0 (Bea y Cleo)
r = await d.getResumenSemanalAmigos(A.id);
assert.equal(r.terminados, 7); assert.equal(r.personas, 2);
assert.equal(r.libroMasLeido.titulo, libros[0]!.title); assert.equal(r.libroMasLeido.veces, 2);
assert.equal(r.quienMas.nombre, B.name); assert.equal(r.quienMas.total, 5);
r = await d.getResumenSemanalAmigos(X.id);
assert.equal(r.terminados, 0);

// Recomiéndame
r = await d.pedirRecomendacion(A.id, B.name);
assert.equal(r.ok, true);
const av = await prisma.notification.findMany({ where: { tipo: 'AMISTAD_PIDE_RECOMENDACION' } });
assert.equal(av.length, 1); assert.equal(av[0]!.userId, B.id);
r = await d.pedirRecomendacion(A.id, B.name);
assert.equal(r.ok, false); assert.match(r.mensaje, /esta semana/);
r = await d.pedirRecomendacion(A.id, X.name);
assert.equal(r.ok, false);
console.log('OK descubrir: quién lo ha leído, afinidad, resumen semanal, recomiéndame');
await prisma.$disconnect();
