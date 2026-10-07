import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { balanceAnual, pilaPorMes } from '../src/services/estanteria-pendientes.service.js';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const router = readFileSync(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8');
const servicio = readFileSync(
  new URL('../src/services/estanteria-pendientes.service.ts', import.meta.url),
  'utf8',
);

test('la pila sube al añadir un pendiente y baja al empezarlo', () => {
  const ahora = d('2026-10-20');
  const serie = pilaPorMes(
    [
      { entro: d('2026-08-10'), salioEn: null },
      { entro: d('2026-08-20'), salioEn: d('2026-09-15') },
      { entro: d('2026-09-05'), salioEn: null },
    ],
    ahora,
  );
  const por = Object.fromEntries(serie.map((p) => [p.mes, p.pila]));
  assert.equal(serie.length, 12);
  assert.equal(por['2026-07'], 0);
  assert.equal(por['2026-08'], 2);
  assert.equal(por['2026-09'], 2); // entra uno y sale otro
  assert.equal(por['2026-10'], 2);
});

test('sin fechas la serie sale a cero y el último punto es el mes actual', () => {
  const serie = pilaPorMes([{ entro: null, salioEn: null }], d('2026-10-20'));
  assert.ok(serie.every((p) => p.pila === 0));
  assert.equal(serie.at(-1)!.mes, '2026-10');
});

test('ebook y audiolibro no entran en la estantería física, y "Solo yo" la oculta', () => {
  assert.match(servicio, /readingFormat === null \|\| f\.readingFormat === ReadingFormat\.PHYSICAL/);
  assert.match(servicio, /otrosFormatos: tengo\.length - enEstanteria\.length/);
  assert.match(servicio, /ProfileVisibility\.PRIVADO\) \{\s*return \{ ok: false, privado: true \}/);
  assert.match(router, /case 'estanteriaPendientes':/);
});

test('el balance del año cuenta lo que salió de la pila, lo que entró y lo que ya estaba en casa', () => {
  const ahora = d('2026-10-20');
  const fila = (entro: string, salio: string | null, owned = false) => ({
    entro: d(entro),
    salioEn: salio ? d(salio) : null,
    enPendiente: salio === null,
    owned,
  });
  const b = balanceAnual(
    [
      fila('2026-01-10', '2026-03-01', true), // leído este año, ya lo tenía
      fila('2026-02-01', '2026-05-01'), // leído este año
      fila('2025-06-01', '2025-09-01', true), // salió el año pasado
      fila('2026-04-01', null), // entró este año, sigue pendiente
      fila('2025-04-01', null), // pendiente de antes
      fila('2026-06-01', '2026-06-01'), // añadido ya empezado: no pasó por la pila
    ],
    ahora,
  );
  assert.deepEqual(b, { anio: 2026, leidos: 2, leidosEnCasa: 1, entraron: 3 });
});
