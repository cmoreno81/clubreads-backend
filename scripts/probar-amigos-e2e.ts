// Prueba de punta a punta de todo lo de «Amigos» sobre una base de datos DE PRUEBAS (no de producción):
// solicitudes, privacidad, reseñas con spoilers, reacciones y comentarios, recomendar, lista de
// deseos y reservas, lecturas a la vez (crear, aceptar, salir, eliminar, bloquear, tope) y avisos.
//
// SE NIEGA a ejecutarse si la base no es local (localhost / 127.0.0.1). Pasos para usarla:
//   1. Tener una base Postgres vacía en local con el esquema aplicado (ver docs/operaciones.md).
//   2. DATABASE_URL="postgresql://postgres@localhost:PUERTO/NOMBRE" npx tsx scripts/probar-amigos-e2e.ts
// Crea usuarios y libros de prueba; en una base ya usada, vacíala antes (TRUNCATE "User","Book","Genre","Club" CASCADE).
const urlBase = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(urlBase)) {
  throw new Error('Esta prueba solo corre contra una base LOCAL de pruebas. DATABASE_URL no lo es.');
}
import assert from 'node:assert/strict';
const R = '../src';
const { prisma } = await import(`${R}/prisma.js`);
const amistades = await import(`${R}/services/amistades.service.js`);
const ver = await import(`${R}/services/amistades-ver.service.js`);
const coment = await import(`${R}/services/amistades-comentarios.service.js`);
const recom = await import(`${R}/services/amistades-recomendar.service.js`);
const regalos = await import(`${R}/services/amistades-regalos.service.js`);
const lect = await import(`${R}/services/lecturas-amistades.service.js`);
const moder = await import(`${R}/services/moderation.service.js`);
const clubs = await import(`${R}/services/clubs.service.js`);
const readings = await import(`${R}/services/readings.service.js`);
const books = await import(`${R}/services/books.service.js`);
const notis = await import(`${R}/services/notifications.service.js`);

const resultados: Array<[string, boolean, string]> = [];
async function paso(nombre: string, fn: () => Promise<void>) {
  try { await fn(); resultados.push([nombre, true, '']); }
  catch (e: any) { resultados.push([nombre, false, String(e?.message ?? e).split('\n')[0]!.slice(0, 220)]); }
}
const notisDe = (userId: string, tipo?: string) => prisma.notification.findMany({ where: { userId, ...(tipo ? { tipo: tipo as any } : {}) }, orderBy: { createdAt: 'asc' } });

// ── Datos de prueba
const mk = (name: string) => prisma.user.create({ data: { name, email: `${name.toLowerCase()}@e2e.test` } });
const A = await mk('Cris M.'), B = await mk('Lucia Prueba'), C = await mk('Marta Prueba'), D = await mk('Pablo Prueba');
const genero = await prisma.genre.create({ data: { name: 'Novela' } });
const libro = (title: string) => prisma.book.create({ data: { title, genreId: genero.id } });
const [L1, L2, L3] = await Promise.all([libro('Yesteryear'), libro('Malas criticas'), libro('Pociones y prejuicios')]);
const lecturaB = await prisma.library.create({ data: { userId: B.id, bookId: L1.id, status: 'READING', currentPage: 40, lastProgress: 40 } });

// ── 5 · Amigos: solicitudes y código
await paso('buscar: con 2 letras avisa y con 3 sale la persona pública', async () => {
  assert.equal(((await amistades.buscarPersonas(A.id, 'lu')) as any).ok, false);
  const r: any = await amistades.buscarPersonas(A.id, 'luc');
  assert.deepEqual(r.personas.map((p: any) => p.nombre), ['Lucia Prueba']);
});
await paso('perfil NO público no sale en la búsqueda', async () => {
  await prisma.user.update({ where: { id: D.id }, data: { profileVisibility: 'CLUB' } });
  const r: any = await amistades.buscarPersonas(A.id, 'pablo');
  assert.equal(r.personas.length, 0);
});
await paso('solicitar A→B: B la recibe con aviso', async () => {
  const r: any = await amistades.solicitarAmistad(A.id, { nombre: 'Lucia Prueba' });
  assert.equal(r.estado, 'ENVIADA');
  await new Promise((x) => setTimeout(x, 200));
  const n = await notisDe(B.id, 'AMISTAD_SOLICITUD');
  assert.equal(n.length, 1); assert.match(n[0]!.mensaje, /Cris M\. te ha enviado una solicitud de amistad/);
  assert.equal(((await amistades.getAmistades(B.id)) as any).recibidas.length, 1);
});
await paso('B acepta: A recibe «Ya sois amigos» y ambos se ven', async () => {
  const r: any = await amistades.responderAmistad(B.id, 'Cris M.', true);
  assert.equal(r.estado, 'AMIGA');
  await new Promise((x) => setTimeout(x, 200));
  assert.equal((await notisDe(A.id, 'AMISTAD_ACEPTADA')).length, 1);
  assert.deepEqual(((await amistades.getAmistades(A.id)) as any).amistades.map((x: any) => x.nombre), ['Lucia Prueba']);
});
await paso('rechazar no avisa a quien envió; cancelar la solicitud la quita', async () => {
  await amistades.solicitarAmistad(C.id, { nombre: 'Lucia Prueba' });
  const antes = (await notisDe(C.id)).length;
  await amistades.responderAmistad(B.id, 'Marta Prueba', false);
  await new Promise((x) => setTimeout(x, 200));
  assert.equal((await notisDe(C.id)).length, antes);
  await amistades.solicitarAmistad(C.id, { nombre: 'Lucia Prueba' });
  assert.equal(((await amistades.cancelarSolicitudAmistad(C.id, 'Lucia Prueba')) as any).ok, true);
  assert.equal(((await amistades.getAmistades(B.id)) as any).recibidas.length, 0);
});
await paso('añadir por código y si la otra ya había enviado, se acepta sola', async () => {
  const codigoD = ((await amistades.getAmistades(D.id)) as any).miCodigo as string;
  assert.match(codigoD, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const r: any = await amistades.solicitarAmistad(A.id, { codigo: codigoD.toLowerCase() });
  assert.equal(r.estado, 'ENVIADA');
  const r2: any = await amistades.solicitarAmistad(D.id, { nombre: 'Cris M.' }); // D (CLUB) no se busca por nombre a sí… pero A es público
  assert.equal(r2.estado, 'AMIGA');
});
await paso('club en común: la búsqueda lo avisa y la lista pone primero a quienes no son del club', async () => {
  await amistades.solicitarAmistad(A.id, { nombre: 'Marta Prueba' }); await amistades.responderAmistad(C.id, 'Cris M.', true);
  const club = await prisma.club.create({ data: { name: 'Club Lunar', slug: 'club-lunar', tipo: 'SOCIAL', ownerId: A.id, members: { create: [{ userId: A.id, role: 'OWNER' }, { userId: C.id, role: 'MEMBER' }] } } });
  const r: any = await amistades.buscarPersonas(A.id, 'marta');
  assert.equal(r.personas[0].clubEnComun, 'Club Lunar');
  const l: any = await amistades.getAmistades(A.id);
  assert.equal(l.amistades.at(-1).nombre, 'Marta Prueba'); // la del club, al final
  assert.equal(l.amistades.at(-1).clubEnComun, 'Club Lunar');
  assert.equal(l.amistades[0].clubEnComun, '');
});

// ── 6 · Privacidad
await paso('interruptores: apagar «leyendo» lo oculta en el perfil', async () => {
  await prisma.library.update({ where: { id: lecturaB.id }, data: { progressNote: 'Me encanta' } });
  const antes: any = await ver.getPerfilAmistad(A.id, 'Lucia Prueba');
  assert.equal(antes.leyendo.length, 1); assert.equal(antes.compartido.leyendo, true);
  await ver.guardarPrivacidadAmistades(B.id, { leyendo: false, biblioteca: true, resenas: true, deseos: true });
  const despues: any = await ver.getPerfilAmistad(A.id, 'Lucia Prueba');
  assert.equal(despues.leyendo.length, 0); assert.equal(despues.compartido.leyendo, false);
  assert.equal(((await ver.getActividadAmistades(A.id)) as any).items.filter((i: any) => i.nombre === 'Lucia Prueba').length, 0);
  await ver.guardarPrivacidadAmistades(B.id, { leyendo: true, biblioteca: true, resenas: true, deseos: true });
});
await paso('reseña con spoilers no enseña el texto; la normal sí', async () => {
  await prisma.review.create({ data: { userId: B.id, bookId: L2.id, rating: 4, review: 'Se muere al final', containsSpoilers: true } });
  await prisma.review.create({ data: { userId: B.id, bookId: L3.id, rating: 5, review: 'Preciosa', containsSpoilers: false } });
  const p: any = await ver.getPerfilAmistad(A.id, 'Lucia Prueba');
  const por = Object.fromEntries(p.resenas.map((r: any) => [r.titulo, r]));
  assert.equal(por['Malas criticas'].texto, ''); assert.equal(por['Pociones y prejuicios'].texto, 'Preciosa');
});

// ── 9 · Reacciones y comentarios
await paso('reaccionar al progreso (también sin club) y repetirla la quita', async () => {
  const r: any = await books.toggleProgressReaction('Cris M.', lecturaB.id, 'THUMBS_UP');
  assert.equal(r.reacciones.THUMBS_UP, 1); assert.equal(r.miReaccion, 'THUMBS_UP');
  const r2: any = await books.toggleProgressReaction('Cris M.', lecturaB.id, 'THUMBS_UP');
  assert.equal(r2.reacciones.THUMBS_UP, 0);
  await books.toggleProgressReaction('Cris M.', lecturaB.id, 'THUMBS_UP');
});
await paso('comentar: aviso a B, B ve resumen y quién reaccionó, un tercero ajeno no puede', async () => {
  assert.equal(((await coment.comentarProgreso(A.id, lecturaB.id, '¡Qué ganas de leerlo!')) as any).ok, true);
  await new Promise((x) => setTimeout(x, 200));
  const n = await notisDe(B.id, 'PROGRESO_COMENTARIO'); assert.equal(n.length, 1);
  assert.match(JSON.parse(n[0]!.extra!).libraryId, new RegExp(lecturaB.id));
  const resumen: any = await coment.getResumenAmigosDeMiLectura(B.id, L1.id);
  assert.deepEqual([resumen.libraryId, resumen.comentarios, resumen.totalReacciones], [lecturaB.id, 1, 1]);
  const hoja: any = await coment.getComentariosProgreso(B.id, lecturaB.id);
  assert.equal(hoja.soyDuena, true); assert.equal(hoja.reaccionesDe[0].nombre, 'Cris M.');
  const ajena: any = await coment.getComentariosProgreso(D.id, lecturaB.id); // D no es amigo de B
  assert.equal(ajena.ok, false);
});
await paso('borrar: quien lo escribió y quien lee pueden; un tercero no', async () => {
  const hoja: any = await coment.getComentariosProgreso(B.id, lecturaB.id);
  const id = hoja.comentarios[0].id;
  assert.equal(((await coment.borrarComentarioProgreso(C.id, id)) as any).ok, false);
  assert.equal(((await coment.borrarComentarioProgreso(B.id, id)) as any).ok, true);
  assert.equal(((await coment.getComentariosProgreso(B.id, lecturaB.id)) as any).comentarios.length, 0);
});
await paso('límite de ritmo: más de 8 comentarios en un minuto avisa', async () => {
  let rechazado = false;
  for (let i = 0; i < 10; i++) { const r: any = await coment.comentarProgreso(A.id, lecturaB.id, `c${i}`); if (!r.ok && /rápido/.test(r.mensaje)) rechazado = true; }
  assert.equal(rechazado, true);
});

// ── 10 · Recomendar
await paso('recomendar: aviso, «a la vez», sin repetir en 30 días, solo a amigos', async () => {
  const r: any = await recom.recomendarLibro(A.id, { bookId: L2.id, nombres: ['Lucia Prueba', 'Persona Inventada'], mensaje: 'Te va a encantar' });
  assert.equal(r.enviadas, 1);
  await new Promise((x) => setTimeout(x, 200));
  const n = await notisDe(B.id, 'LIBRO_RECOMENDADO'); assert.match(n[0]!.mensaje, /Cris M\. te recomienda «Malas criticas»: «Te va a encantar»/);
  const otra: any = await recom.recomendarLibro(A.id, { bookId: L2.id, nombres: ['Lucia Prueba'] });
  assert.equal(otra.enviadas, 0); assert.equal(otra.yaRecomendado, 1);
  const juntas: any = await recom.recomendarLibro(A.id, { bookId: L3.id, nombres: ['Lucia Prueba'], juntas: true });
  await new Promise((x) => setTimeout(x, 200));
  assert.match((await notisDe(B.id, 'LIBRO_RECOMENDADO')).at(-1)!.mensaje, /a la vez/); assert.equal(juntas.enviadas, 1);
});

// ── 11 · Lista de deseos y «Lo regalo yo»
let deseo: any;
await paso('deseos: A ve la lista sin precio ni notas; reservar y ver «ya reservado» desde un tercero', async () => {
  deseo = await prisma.wishlistItem.create({ data: { userId: B.id, title: 'Libro regalo', author: 'Autora', price: 19.9, note: 'privado', priority: 'HIGH' } });
  await amistades.solicitarAmistad(C.id, { nombre: 'Lucia Prueba' }); await amistades.responderAmistad(B.id, 'Marta Prueba', true);
  const p: any = await ver.getPerfilAmistad(A.id, 'Lucia Prueba');
  assert.deepEqual(Object.keys(p.deseos[0]).sort(), ['autor', 'bookId', 'coverUrl', 'formato', 'id', 'prioridad', 'reservado', 'reservadoPorMi', 'titulo']);
  assert.equal(((await regalos.reservarRegalo(A.id, deseo.id, true)) as any).ok, true);
  const mia: any = await ver.getPerfilAmistad(A.id, 'Lucia Prueba'); assert.deepEqual([mia.deseos[0].reservado, mia.deseos[0].reservadoPorMi], [true, true]);
  const tercero: any = await ver.getPerfilAmistad(C.id, 'Lucia Prueba'); assert.deepEqual([tercero.deseos[0].reservado, tercero.deseos[0].reservadoPorMi], [true, false]);
  assert.equal(JSON.stringify(tercero).includes('Cris'), false); // sin nombre de quien reserva
  assert.equal(((await regalos.reservarRegalo(C.id, deseo.id, true)) as any).ok, false);
});
await paso('quitar la amistad libera la reserva; la dueña nunca ve reservas', async () => {
  assert.equal(((await amistades.quitarAmistad(A.id, 'Lucia Prueba')) as any).ok, true);
  assert.equal(await prisma.wishlistReservation.count(), 0);
  await amistades.solicitarAmistad(A.id, { nombre: 'Lucia Prueba' }); await amistades.responderAmistad(B.id, 'Cris M.', true);
  await regalos.reservarRegalo(A.id, deseo.id, true);
  const fuente = (await import('node:fs')).readFileSync('src/services/wishlist.service.ts', 'utf8');
  assert.equal(/reservation/.test(fuente), false);
});
await paso('apagar «mi lista de deseos» la oculta; comprar el libro lo quita', async () => {
  await ver.guardarPrivacidadAmistades(B.id, { leyendo: true, biblioteca: true, resenas: true, deseos: false });
  assert.equal(((await ver.getPerfilAmistad(A.id, 'Lucia Prueba')) as any).deseos.length, 0);
  await ver.guardarPrivacidadAmistades(B.id, { leyendo: true, biblioteca: true, resenas: true, deseos: true });
  await prisma.wishlistItem.update({ where: { id: deseo.id }, data: { purchasedAt: new Date() } });
  assert.equal(((await ver.getPerfilAmistad(A.id, 'Lucia Prueba')) as any).deseos.length, 0);
  await prisma.wishlistItem.update({ where: { id: deseo.id }, data: { purchasedAt: null } });
});

// ── 12 · Lecturas a la vez
let clubPareja = '';
await paso('crear lectura a la vez: no avisa hasta configurar; el aviso sale al enviar la invitación', async () => {
  const r: any = await lect.crearLecturaConAmistad(A.id, { bookId: L2.id, nombre: 'Lucia Prueba' });
  assert.equal(r.ok, true); clubPareja = r.clubId;
  assert.equal((await notisDe(B.id, 'LECTURA_AMISTAD_INVITACION')).length, 0);
  assert.equal(((await lect.getLecturasAmistades(B.id)) as any).recibidas.length, 0);
  assert.equal(((await lect.enviarInvitacionLectura(A.id, clubPareja)) as any).ok, false); // sin lectura configurada
  await clubs.selectClub(A.id, clubPareja);
  assert.equal(((await readings.crearLectura({ usuario: 'Cris M.', libro: 'Malas criticas', capitulos: 3, prologo: false, epilogo: false, tipo: 'LIBRE' })) as any).ok, true);
  assert.equal(((await lect.enviarInvitacionLectura(A.id, clubPareja)) as any).ok, true);
  await new Promise((x) => setTimeout(x, 200));
  assert.equal((await notisDe(B.id, 'LECTURA_AMISTAD_INVITACION')).length, 1);
  assert.equal(((await lect.getLecturasAmistades(B.id)) as any).recibidas.length, 1);
  assert.equal(((await lect.enviarInvitacionLectura(A.id, clubPareja)) as any).yaEnviada, true); // una sola vez
});
await paso('aceptar: B entra, comentan los dos, no sale en «Tus clubes» y no se puede invitar a nadie más', async () => {
  assert.equal(((await lect.responderLecturaAmistad(B.id, clubPareja, true)) as any).aceptada, true);
  await clubs.selectClub(B.id, clubPareja);
  const c: any = await readings.enviarComentarioLectura({ usuario: 'Lucia Prueba', libro: 'Malas criticas', capitulo: 'Capítulo 1', comentario: 'Hola desde B', tipo: 'COMMENT' });
  assert.equal(c.ok, true);
  const vistos: any = await readings.getComentariosLectura('Malas criticas', 'Capítulo 1', 'Cris M.');
  assert.equal(vistos.comentarios[0].comentario, 'Hola desde B');
  assert.deepEqual(((await clubs.listMyClubs(A.id)) as any).clubs.map((x: any) => x.tipo).filter((t: string) => t === 'AMISTADES'), []);
  const cfg: any = await readings.getConfiguracionLectura('Malas criticas', 'Cris M.'); assert.equal(cfg.esAmistades, true);
  await assert.rejects(clubs.getInvite(A.id, clubPareja), /no admiten más personas/);
});
await paso('quitar la amistad NO toca la lectura; la tienen las dos', async () => {
  await amistades.quitarAmistad(A.id, 'Lucia Prueba');
  assert.equal(((await lect.getLecturasAmistades(A.id)) as any).lecturas.length, 1);
  assert.equal(((await lect.getLecturasAmistades(B.id)) as any).lecturas.length, 1);
  await amistades.solicitarAmistad(A.id, { nombre: 'Lucia Prueba' }); await amistades.responderAmistad(B.id, 'Cris M.', true);
});
await paso('terminarla las dos la pasa a «terminada»; no cuenta para el tope de 5', async () => {
  const antes: any = await lect.getLecturasAmistades(A.id); assert.equal(antes.lecturas[0].terminada, false);
  for (const u of [A, B]) await prisma.readingCompletion.create({ data: { userId: u.id, bookId: L2.id, startedAt: new Date(Date.now() - 86400000), finishedAt: new Date() } });
  const d: any = await lect.getLecturasAmistades(A.id); assert.equal(d.lecturas[0].terminada, true);
});
await paso('tope: con 5 en curso no deja crear otra', async () => {
  const extra = await Promise.all([1, 2, 3, 4, 5].map((i) => libro(`Libro tope ${i}`)));
  for (const b of extra) { const r: any = await lect.crearLecturaConAmistad(A.id, { bookId: b.id, nombre: 'Lucia Prueba' }); assert.equal(r.ok, true); }
  const sexta: any = await lect.crearLecturaConAmistad(A.id, { bookId: (await libro('Libro tope 6')).id, nombre: 'Lucia Prueba' });
  assert.equal(sexta.ok, false);
});
await paso('salir: la otra conserva la conversación y pasa a propietaria; eliminar solo quien la abrió', async () => {
  const miembroB = await prisma.clubMember.findFirst({ where: { clubId: clubPareja, userId: B.id } });
  assert.equal(miembroB?.role, 'MEMBER');
  assert.equal(((await lect.salirLecturaAmistad(B.id, clubPareja, true)) as any).ok, false); // B no la abrió: no puede eliminar
  assert.equal(((await lect.salirLecturaAmistad(A.id, clubPareja, false)) as any).ok, true);
  const nuevo = await prisma.club.findUnique({ where: { id: clubPareja } }); assert.equal(nuevo?.ownerId, B.id);
  const l: any = await lect.getLecturasAmistades(B.id); assert.equal(l.lecturas.find((x: any) => x.clubId === clubPareja).salio, true);
  assert.equal(((await lect.salirLecturaAmistad(B.id, clubPareja, true)) as any).ok, true);
  await new Promise((x) => setTimeout(x, 200));
  assert.equal(await prisma.club.count({ where: { id: clubPareja } }), 0);
});
await paso('rechazar una invitación retira el espacio sin avisar', async () => {
  const l2 = await libro('Libro rechazado');
  // se libera sitio: el tope cuenta 5 abiertas, así que se usa otra pareja (A con C)
  const r: any = await lect.crearLecturaConAmistad(C.id, { bookId: l2.id, nombre: 'Lucia Prueba' });
  assert.equal(r.ok, true);
  await clubs.selectClub(C.id, r.clubId);
  await readings.crearLectura({ usuario: 'Marta Prueba', libro: 'Libro rechazado', capitulos: 2, prologo: false, epilogo: false, tipo: 'LIBRE' });
  await lect.enviarInvitacionLectura(C.id, r.clubId);
  const antes = (await notisDe(C.id)).length;
  assert.equal(((await lect.responderLecturaAmistad(B.id, r.clubId, false)) as any).ok, true);
  await new Promise((x) => setTimeout(x, 200));
  assert.equal((await notisDe(C.id)).length, antes); assert.equal(await prisma.club.count({ where: { id: r.clubId } }), 0);
});
await paso('bloquear: la bloqueada sale de las lecturas compartidas; la conversación queda para quien bloquea', async () => {
  const lb = await libro('Libro para bloquear');
  const r: any = await lect.crearLecturaConAmistad(C.id, { bookId: lb.id, nombre: 'Lucia Prueba' });
  await clubs.selectClub(C.id, r.clubId);
  await readings.crearLectura({ usuario: 'Marta Prueba', libro: 'Libro para bloquear', capitulos: 2, prologo: false, epilogo: false, tipo: 'LIBRE' });
  await lect.enviarInvitacionLectura(C.id, r.clubId); await lect.responderLecturaAmistad(B.id, r.clubId, true);
  await moder.bloquearUsuario(C.id, 'Lucia Prueba');
  assert.equal(await prisma.clubMember.count({ where: { clubId: r.clubId, userId: B.id } }), 0);
  assert.equal(await prisma.clubMember.count({ where: { clubId: r.clubId, userId: C.id } }), 1);
  assert.equal(await prisma.friendship.count({ where: { OR: [{ requesterId: C.id, addresseeId: B.id }, { requesterId: B.id, addresseeId: C.id }] } }), 0);
});

// ── 13 · Notificaciones y ajustes
await paso('Ajustes → Notificaciones ofrece los avisos de amigos y de metas', async () => {
  const p: any = await notis.getPreferenciasNotificacion(A.id);
  const tipos = p.tipos.map((t: any) => t.tipo);
  for (const t of ['AMISTAD_SOLICITUD', 'AMISTAD_ACEPTADA', 'PROGRESO_COMENTARIO', 'LIBRO_RECOMENDADO', 'LECTURA_AMISTAD_INVITACION', 'LECTURA_AMISTAD_ACEPTADA', 'LECTURA_AMISTAD_ELIMINADA', 'LECTURA_META_PROXIMA', 'LECTURA_META_HOY', 'LECTURA_INVITACION']) assert.ok(tipos.includes(t), `falta ${t}`);
});
await paso('apagar un tipo de aviso impide que llegue', async () => {
  await notis.actualizarPreferenciaNotificacion(B.id, 'LIBRO_RECOMENDADO' as any, false);
  const antes = (await notisDe(B.id, 'LIBRO_RECOMENDADO')).length;
  const r2 = await libro('Para apagar');
  await recom.recomendarLibro(A.id, { bookId: r2.id, nombres: ['Lucia Prueba'] });
  await new Promise((x) => setTimeout(x, 200));
  assert.equal((await notisDe(B.id, 'LIBRO_RECOMENDADO')).length, antes);
});

console.log('\n==== RESULTADO ====');
for (const [n, ok, e] of resultados) console.log(`${ok ? 'OK ' : 'FALLA'}  ${n}${ok ? '' : '\n        → ' + e}`);
console.log(`\n${resultados.filter((r) => r[1]).length}/${resultados.length} pasos correctos`);
await prisma.$disconnect();
