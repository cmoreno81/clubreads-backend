import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const books = readFileSync('src/services/books.service.ts', 'utf8');
const notifications = readFileSync(
  'src/services/notifications.service.ts',
  'utf8',
);

test('pasar un libro pendiente a leyendo avisa al resto del club una vez', () => {
  assert.match(schema, /LIBRO_EMPEZADO/);
  assert.match(
    books,
    /effectiveStatus === ReadingStatus\.READING[\s\S]*currentLibrary\?\.status !== ReadingStatus\.READING/,
  );
  assert.match(books, /if \(startedReading\)[\s\S]*notifyLibroEmpezado/);
  assert.match(
    notifications,
    /NotificationType\.LIBRO_EMPEZADO[\s\S]*ha empezado a leer/,
  );
  assert.match(
    notifications,
    /notifyLibroEmpezado[\s\S]*excludeUserId: lectoraUserId/,
  );
});
