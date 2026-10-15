// Prueba de punta a punta de los retos entre amistades y la racha compartida sobre una base LOCAL VACÍA.
// DATABASE_URL=postgresql://postgres@localhost:PUERTO/NOMBRE npx tsx scripts/probar-retos-amigos-e2e.ts
const urlBase = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(urlBase)) throw new Error('Solo base local.');
import assert from 'node:assert/strict';
const R = '../src';
const { prisma } = await import(`${R}/prisma.js`);
const am = await import(`${R}/services/amistades.service.js`);
const r3 = await import(`${R}/services/amistades-retos.service.js`);
const sfx = Date.now();
const mk = (n: string) => prisma.user.create({ data: { name: `${n}${sfx}`, email: `${n}${sfx}@e.test` } });
const A = await mk('Ana'), B = await mk('Bea'), C = await mk('Cleo'), X = await mk('Extrana');
const g = await prisma.genre.upsert({ where: { name: 'Fantasía' }, update: {}, create: { name: 'Fantasía' } });
const libros = [];
for (let i = 0; i < 4; i++) libros.push(await prisma.book.create({ data: { title: `R${i}-${sfx}`, genreId: g.id } }));
for (const y of [B, C]) { await am.solicitarAmistad(A.id, { nombre: y.name }); await am.responderAmistad(y.id, A.name, true); }
const termina = (u: any, b: any) => prisma.readingCompletion.create({ data: { userId: u.id, bookId: b.id, finishedAt: new Date(), rating: 4 } });

// Crear: solo con amistades, meta válida
let r: any = await r3.crearRetoAmigos(A.id, { titulo: 'Retazo', objetivo: 4, periodo: 'MES', nombres: [X.name] });
assert.equal(r.ok, false);
r = await r3.crearRetoAmigos(A.id, { titulo: 'Retazo', objetivo: 0, periodo: 'MES', nombres: [B.name] });
assert.equal(r.ok, false);
r = await r3.crearRetoAmigos(A.id, { titulo: 'Retazo', objetivo: 4, periodo: 'MES', nombres: [B.name, C.name] });
assert.equal(r.ok, true);
const id = r.id;

// Bea aún no ha aceptado: ve la propuesta como invitada y no suma
await termina(A, libros[0]); await termina(B, libros[1]);
r = await r3.getRetosAmigos(B.id);
assert.equal(r.items.length, 1);
assert.equal(r.items[0].invitada, true);
assert.equal(r.items[0].total, 1, 'solo suma Ana mientras Bea no acepte');
r = await r3.getRetosAmigos(X.id);
assert.equal(r.items.length, 0);

// Bea acepta: el total pasa a 2; Cleo rechaza
await r3.responderRetoAmigos(B.id, id, true);
await r3.responderRetoAmigos(C.id, id, false);
r = await r3.getRetosAmigos(A.id);
assert.equal(r.items[0].total, 2);
assert.equal(r.items[0].personas.length, 2);
assert.equal(r.items[0].personas[0].yo, true, 'tú primero, el resto por nombre');
await termina(B, libros[2]); await termina(A, libros[3]);
r = await r3.getRetosAmigos(A.id);
assert.equal(r.items[0].total, 4);
assert.equal(r.items[0].conseguido, true);

// Releer el mismo libro no suma dos veces
await termina(A, libros[0]);
assert.equal((await r3.getRetosAmigos(A.id)).items[0].total, 4);

// Salir: si no queda nadie, el reto desaparece
await r3.salirRetoAmigos(B.id, id);
assert.equal((await r3.getRetosAmigos(A.id)).items.length, 1);
await r3.salirRetoAmigos(A.id, id);
assert.equal(await prisma.retoAmistad.count({ where: { id } }), 0);

// Límite de retos en marcha
for (let i = 0; i < 3; i++) assert.equal((await r3.crearRetoAmigos(A.id, { titulo: `x${i}`, objetivo: 2, periodo: 'ANO', nombres: [B.name] })).ok, true);
assert.equal((await r3.crearRetoAmigos(A.id, { titulo: 'x', objetivo: 2, periodo: 'ANO', nombres: [B.name] })).ok, false);

// Racha compartida
const hoy = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
for (const n of [0, 1, 2]) { await prisma.dailyCheckin.create({ data: { userId: A.id, date: hoy(n) } }); await prisma.dailyCheckin.create({ data: { userId: B.id, date: hoy(n) } }); }
await prisma.dailyCheckin.create({ data: { userId: C.id, date: hoy(0) } });
r = await r3.getRachasCompartidas(A.id);
assert.equal(r.items.length, 1);
assert.equal(r.items[0].nombre, B.name);
assert.equal(r.items[0].dias, 3);
await prisma.user.update({ where: { id: B.id }, data: { friendsSeeReading: false } });
assert.equal((await r3.getRachasCompartidas(A.id)).items.length, 0, 'respeta «lo que leo»');
console.log('OK retos y racha compartida');
await prisma.$disconnect();
