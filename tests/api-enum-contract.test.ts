import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionBodySchemas,
  formatSchema,
  prioritySchema,
  readingTypeSchema,
  reactionSchema,
  statusSchema,
} from '../src/validation/api-validation.js';

function parsedBody(action: string, fixture: Record<string, unknown>) {
  return actionBodySchemas[action].parse(fixture) as Record<string, unknown>;
}

test('contrato Flutter: añadir un libro pendiente normaliza preferencias para Prisma', () => {
  const body = parsedBody('anadirLibroExistente', {
    libro: 'book-1',
    prioridad: 'ALTA',
    formato: 'FISICO',
  });
  assert.deepEqual(body, { libro: 'book-1', prioridad: 'HIGH', formato: 'PHYSICAL' });
});

test('contrato Flutter: cambiar a pendiente normaliza el estado', () => {
  const body = parsedBody('actualizarEstado', {
    libro: 'book-1', estado: 'PENDIENTE', valoracion: '', reflexion: '',
    motivoPausa: '', fechaInicio: '', fechaFin: '', formato: '',
  });
  assert.equal(body.estado, 'PENDING');
  assert.equal(body.formato, '');
});

test('contrato Flutter: importar un audiolibro normaliza estado, formato y prioridad', () => {
  const body = parsedBody('importarLibroCatalogo', {
    id: 'external-1', origen: 'GOOGLE', titulo: 'Libro de prueba',
    autores: ['Autora de prueba'], prioridad: 'MEDIA', formato: 'AUDIOLIBRO',
    estado: 'PENDIENTE',
  });
  assert.equal(body.estado, 'PENDING');
  assert.equal(body.formato, 'AUDIOBOOK');
  assert.equal(body.prioridad, 'MEDIUM');
});

test('contrato Flutter: actualizar preferencias acepta audiolibro', () => {
  const body = parsedBody('actualizarPreferenciasLibro', {
    libro: 'book-1', prioridad: 'BAJA', formato: 'AUDIOLIBRO',
  });
  assert.deepEqual(body, { libro: 'book-1', prioridad: 'LOW', formato: 'AUDIOBOOK' });
});

test('contrato Flutter: finalizar conserva el formato de audiolibro', () => {
  const body = parsedBody('actualizarEstado', {
    libro: 'book-1', estado: 'FINALIZADO', valoracion: '4.5', reflexion: '',
    motivoPausa: '', fechaInicio: '2026-08-01', fechaFin: '2026-08-09',
    formato: 'AUDIOLIBRO',
  });
  assert.equal(body.estado, 'FINISHED');
  assert.equal(body.formato, 'AUDIOBOOK');
});

test('todos los estados Flutter e internos convergen en el enum Prisma', () => {
  const cases = [
    ['PENDIENTE', 'PENDING'], ['PENDING', 'PENDING'],
    ['LEYENDO', 'READING'], ['READING', 'READING'],
    ['PAUSADO', 'PAUSED'], ['PAUSED', 'PAUSED'],
    ['FINALIZADO', 'FINISHED'], ['FINISHED', 'FINISHED'],
    ['ABANDONADO', 'ABANDONED'], ['ABANDONED', 'ABANDONED'],
    ['RELECTURA', 'REREADING'], ['RELEYENDO', 'REREADING'], ['REREADING', 'REREADING'],
  ] as const;
  for (const [input, expected] of cases) assert.equal(statusSchema.parse(input), expected);
});

test('formatos, prioridades y tipos de lectura convergen en los enums Prisma', () => {
  for (const [input, expected] of [
    ['FISICO', 'PHYSICAL'], ['PHYSICAL', 'PHYSICAL'],
    ['DIGITAL', 'DIGITAL'], ['AUDIOLIBRO', 'AUDIOBOOK'], ['AUDIOBOOK', 'AUDIOBOOK'],
  ] as const) assert.equal(formatSchema.parse(input), expected);
  for (const [input, expected] of [
    ['BAJA', 'LOW'], ['LOW', 'LOW'], ['MEDIA', 'MEDIUM'], ['MEDIUM', 'MEDIUM'], ['ALTA', 'HIGH'], ['HIGH', 'HIGH'],
  ] as const) assert.equal(prioritySchema.parse(input), expected);
  assert.equal(readingTypeSchema.parse('LIBRE'), 'FREE');
  assert.equal(readingTypeSchema.parse('OFICIAL'), 'CLUBVISION');
});

test('las reacciones vigentes se validan sin traducción', () => {
  for (const reaction of ['LIKE', 'AGREE', 'ANGRY', 'FUNNY', 'THUMBS_UP', 'CRY', 'WOW', 'SWEAR', 'CLAP']) {
    assert.equal(reactionSchema.parse(reaction), reaction);
  }
});

test('valores desconocidos y errores tipográficos se rechazan', () => {
  for (const value of ['PENDIETE', 'READ', 'terminado']) assert.equal(statusSchema.safeParse(value).success, false);
  for (const value of ['AUDIOLIB', 'KINDLE', 'audiolibro']) assert.equal(formatSchema.safeParse(value).success, false);
  assert.equal(prioritySchema.safeParse('URGENTE').success, false);
  assert.equal(readingTypeSchema.safeParse('PRIVADA').success, false);
  assert.equal(reactionSchema.safeParse('LOVE').success, false);
});
