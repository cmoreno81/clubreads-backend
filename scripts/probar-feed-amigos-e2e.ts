// Prueba de punta a punta del feed de amistades y del aviso «ha terminado tu lectura» sobre una base LOCAL de pruebas.
// DATABASE_URL=postgresql://postgres@localhost:PUERTO/NOMBRE npx tsx scripts/probar-feed-amigos-e2e.ts
// Necesita una base VACÍA (o vaciada: TRUNCATE "User","Book","Genre" CASCADE): cuenta avisos y resultados globales.
const urlBase = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(urlBase)) throw new Error('Solo base local.');
import assert from 'node:assert/strict';
const R = '../src';
const { prisma } = await import(`${R}/prisma.js`);
const am = await import(`${R}/services/amistades.service.js`);
const feed = await import(`${R}/services/amistades-feed.service.js`);
const books = await import(`${R}/services/books.service.js`);
const sfx = Date.now();
const mk = (n: string) => prisma.user.create({ data: { name: `${n}${sfx}`, email: `${n}${sfx}@e.test` } });
const A = await mk('Ana'), B = await mk('Bea'), C = await mk('Cleo'), D = await mk('Dani');
const g = await prisma.genre.upsert({ where: { name: 'Novela' }, update: {}, create: { name: 'Novela' } });
const L1 = await prisma.book.create({ data: { title: `Libro1-${sfx}`, genreId: g.id } });
const L2 = await prisma.book.create({ data: { title: `Libro2-${sfx}`, genreId: g.id } });
for (const [x, y] of [[A, B], [A, C]] as any) { await am.solicitarAmistad(x.id, { nombre: y.name }); await am.responderAmistad(y.id, x.name, true); }
const day = (d: number) => new Date(Date.now() - d * 86400000);
// Bea: terminó L1 con reseña normal; Cleo: terminó L2 con reseña con spoilers; Dani (no amiga): empezó L1
const lb = await prisma.library.create({ data: { userId: B.id, bookId: L1.id, status: 'FINISHED', startedAt: day(5), finishedAt: day(1) } });
await prisma.review.create({ data: { userId: B.id, bookId: L1.id, rating: 4.5, review: 'Me ha encantado, '.repeat(30) } });
const lc = await prisma.library.create({ data: { userId: C.id, bookId: L2.id, status: 'FINISHED', startedAt: day(9), finishedAt: day(3) } });
await prisma.review.create({ data: { userId: C.id, bookId: L2.id, rating: 3, review: 'El final me dejó helada', containsSpoilers: true } });
await prisma.library.create({ data: { userId: D.id, bookId: L1.id, status: 'READING', startedAt: day(1) } });
await prisma.library.create({ data: { userId: B.id, bookId: L2.id, status: 'READING', startedAt: day(2) } });
await prisma.progressReaction.create({ data: { libraryId: lb.id, userId: A.id, reaction: 'LIKE' } });
await prisma.progressComment.create({ data: { libraryId: lb.id, userId: C.id, text: 'Yo también' } });

let f: any = await feed.getFeedAmistades(A.id);
assert.equal(f.ok, true);
const nombres = f.items.map((i: any) => `${i.tipo}:${i.nombre}`);
assert.ok(nombres.includes(`TERMINO:${B.name}`) && nombres.includes(`TERMINO:${C.name}`) && nombres.includes(`EMPEZO:${B.name}`));
assert.ok(!nombres.some((n: string) => n.includes(D.name)), 'una persona que no es amiga no sale');
const bt = f.items.find((i: any) => i.tipo === 'TERMINO' && i.nombre === B.name);
assert.equal(bt.valoracion, 4.5);
assert.ok(bt.resena.endsWith('…') && bt.resena.length <= 160);
assert.equal(bt.comentarios, 1);
assert.equal(bt.miReaccion, 'LIKE');
assert.equal(bt.reacciones.LIKE, 1);
const ct = f.items.find((i: any) => i.tipo === 'TERMINO' && i.nombre === C.name);
assert.equal(ct.resena, '', 'con spoilers el texto no sale');
assert.equal(ct.contieneSpoilers, true);
assert.equal(ct.valoracion, 3);
// orden: más reciente primero
const fechas = f.items.map((i: any) => i.fecha);
assert.deepEqual([...fechas].sort().reverse(), fechas);

// privacidad: Cleo apaga «lo que leo» → desaparece; Bea apaga reseñas → sin nota ni texto
await prisma.user.update({ where: { id: C.id }, data: { friendsSeeReading: false } });
await prisma.user.update({ where: { id: B.id }, data: { friendsSeeReviews: false } });
f = await feed.getFeedAmistades(A.id);
assert.ok(!f.items.some((i: any) => i.nombre === C.name));
const bt2 = f.items.find((i: any) => i.tipo === 'TERMINO' && i.nombre === B.name);
assert.equal(bt2.valoracion, null); assert.equal(bt2.resena, '');
// bloqueo: A bloquea a B
await prisma.userBlock.create({ data: { blockerId: A.id, blockedId: B.id } });
f = await feed.getFeedAmistades(A.id);
assert.equal(f.items.length, 0);
await prisma.userBlock.deleteMany({});
await prisma.user.update({ where: { id: B.id }, data: { friendsSeeReviews: true } });
await prisma.user.update({ where: { id: C.id }, data: { friendsSeeReading: true } });

// Aviso: A lee L2 ahora. Cleo termina L2 desde el flujo real → A recibe aviso; Bea (también lee L2 y es amiga de A pero no de Cleo) no.
await prisma.library.create({ data: { userId: A.id, bookId: L2.id, status: 'READING', startedAt: day(1) } });
await prisma.library.update({ where: { id: lc.id }, data: { status: 'READING', finishedAt: null } });
await prisma.readingCompletion.deleteMany({ where: { userId: C.id } });
const n = await feed.notificarAmistadesLibroTerminado({ userId: C.id, nombre: C.name, bookId: L2.id, bookTitle: L2.title });
assert.equal(n, 1, 'solo Ana (amiga de Cleo que lee el libro)');
const avisos = await prisma.notification.findMany({ where: { tipo: 'AMISTAD_LIBRO_TERMINADO' } });
assert.equal(avisos.length, 1); assert.equal(avisos[0]!.userId, A.id);
assert.match(avisos[0]!.mensaje, /ha terminado .*el libro que estás leyendo/);
// Si Cleo no comparte lo que lee, no avisa
await prisma.user.update({ where: { id: C.id }, data: { friendsSeeReading: false } });
assert.equal(await feed.notificarAmistadesLibroTerminado({ userId: C.id, nombre: C.name, bookId: L2.id, bookTitle: L2.title }), 0);
console.log('OK feed + privacidad + bloqueo + aviso');
await prisma.$disconnect();
