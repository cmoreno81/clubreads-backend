import assert from 'node:assert/strict';
import test from 'node:test';

import { actionBodySchemas } from '../src/validation/api-validation.js';

const base = { bookId: 'b1', usuario: 'Cris M.', libro: 'El pozo de la ascensión (Nacidos de la bruma 2)', genero: 'Fantasía', generosExtra: [] };
const incrustada = `data:image/jpeg;base64,${'A'.repeat(11_000)}`;

test('editar un libro cuya portada está incrustada (data:) no falla y la conserva', () => {
  const r = actionBodySchemas['editarLibro']!.safeParse({ ...base, coverUrl: incrustada });
  assert.equal(r.success, true, JSON.stringify(!r.success && r.error.issues));
  assert.equal((r as any).data.coverUrl, undefined); // no se toca la portada guardada
});

test('una portada con URL normal se acepta y una URL mal escrita sigue rechazándose', () => {
  const buena = actionBodySchemas['editarLibro']!.safeParse({ ...base, coverUrl: 'https://res.cloudinary.com/x/portada.jpg' });
  assert.equal(buena.success, true);
  assert.equal((buena as any).data.coverUrl, 'https://res.cloudinary.com/x/portada.jpg');
  const mala = actionBodySchemas['editarLibro']!.safeParse({ ...base, coverUrl: 'esto no es una url' });
  assert.equal(mala.success, false);
});

test('el cambio solo afecta a editar: añadir un libro sigue exigiendo una URL de verdad', () => {
  const r = actionBodySchemas['crearLibro']!.safeParse({ titulo: 'X', coverUrl: incrustada });
  assert.equal(r.success, false);
});
