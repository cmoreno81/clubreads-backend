import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { prisma } from '../src/prisma.js';
import {
  fichaTalentoSchema,
  normalizarTropos,
  recibirFichaTalento,
} from '../src/services/talento-emergente.service.js';

const valida = () => ({
  titulo: 'Entre dos tormentas',
  autora: 'Lucía Marín',
  email: 'Lucia@Example.com',
  genero: 'Romance',
  generosExtra: ['Paranormal', 'Romance', 'Drama', 'Terror'],
  picante: 3,
  tropos: ['enemies to lovers', 'Enemies to lovers', 'slow burn'],
  sinopsis: 'Una novela de segundas oportunidades en un pueblo costero donde nadie guarda secretos.',
  enlace: 'https://www.amazon.es/dp/B0TEST',
  portada: 'data:image/jpeg;base64,AAAA',
  derechos: true,
  contenidoAdulto: true,
  condiciones: true,
});

function fakePrisma(opts: { pendientes?: number; delCorreo?: number } = {}) {
  const creadas: Array<Record<string, unknown>> = [];
  Object.defineProperty(prisma, 'emergingTalentSubmission', {
    configurable: true,
    value: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        where.status ? (opts.pendientes ?? 0) : (opts.delCorreo ?? 0),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creadas.push(data);
        return { id: 'f1', title: data.title, authorName: data.authorName };
      },
    },
  });
  return creadas;
}

const subir = async () => ({ url: 'https://img/c.jpg', publicId: 'c' });

test('la ficha válida se normaliza: correo en minúsculas, máximo 3 géneros, sin tropos repetidos', async () => {
  const creadas = fakePrisma();
  const r = await recibirFichaTalento(valida(), '1.2.3.4', subir);
  assert.deepEqual(r, { ok: true, id: 'f1' });
  const dato = creadas[0]!;
  assert.equal(dato.contactEmail, 'lucia@example.com');
  assert.deepEqual(dato.extraGenres, ['Paranormal', 'Drama']);
  assert.deepEqual(dato.tropes, ['enemies to lovers', 'slow burn']);
  assert.equal(dato.coverUrl, 'https://img/c.jpg');
  assert.match(String(dato.ipHash), /^[0-9a-f]{32}$/);
});

test('rechaza lo que falta o está mal y dice qué campos', async () => {
  fakePrisma();
  const r = await recibirFichaTalento(
    { ...valida(), enlace: 'http://inseguro.es', derechos: false, sinopsis: 'corta' },
    '1.2.3.4',
    subir,
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.deepEqual([...(r.campos ?? [])].sort(), ['derechos', 'enlace', 'sinopsis']);
  }
});

test('un género fuera de la lista no pasa', () => {
  assert.equal(fichaTalentoSchema.safeParse({ ...valida(), genero: 'Inventado' }).success, false);
});

test('la trampa de bots responde ok sin guardar nada', async () => {
  const creadas = fakePrisma();
  const r = await recibirFichaTalento({ ...valida(), web: 'http://spam' }, '1.2.3.4', subir);
  assert.equal(r.ok, true);
  assert.equal(creadas.length, 0);
});

test('límites: demasiadas pendientes y demasiadas fichas del mismo correo en un día', async () => {
  fakePrisma({ pendientes: 300 });
  const lleno = await recibirFichaTalento(valida(), 'ip', subir);
  assert.equal(!lleno.ok && lleno.status, 503);
  fakePrisma({ delCorreo: 3 });
  const repetido = await recibirFichaTalento(valida(), 'ip', subir);
  assert.equal(!repetido.ok && repetido.status, 429);
});

test('si la portada no se puede subir, no se guarda la ficha', async () => {
  const creadas = fakePrisma();
  const r = await recibirFichaTalento(valida(), 'ip', async () => {
    throw new Error('boom');
  });
  assert.equal(!r.ok && r.status, 422);
  assert.equal(creadas.length, 0);
});

test('normalizarTropos quita vacíos y repetidos sin distinguir mayúsculas', () => {
  assert.deepEqual(normalizarTropos([' a ', 'A', '', 'b']), ['a', 'b']);
});

test('la ruta pública va antes del router autenticado y la migración crea la tabla', () => {
  const server = readFileSync('src/server.ts', 'utf8');
  assert.ok(
    server.indexOf("app.use('/api/talento'") < server.indexOf("app.use('/api', apiRateLimiter"),
  );
  const carpeta = readdirSync('prisma/migrations').find((d) => d.endsWith('emerging_talent_submissions'));
  assert.ok(carpeta);
  const sql = readFileSync(`prisma/migrations/${carpeta}/migration.sql`, 'utf8');
  assert.match(sql, /CREATE TABLE "EmergingTalentSubmission"/);
  assert.match(sql, /EmergingTalentStatus/);
});
