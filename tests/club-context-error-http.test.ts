import assert from 'node:assert/strict';
import test from 'node:test';

import { globalErrorHandler } from '../src/middleware/request-observability.middleware.js';
import { handleApi } from '../src/routes/api.router.js';
import { handleUpdateClubWith } from '../src/controllers/clubs.controller.js';
import { ClubContextError } from '../src/services/club-context.service.js';

function responseMock() {
  let statusCode = 200;
  let payload: any;
  const res: any = {
    locals: { requestId: 'club-error-test' },
    headersSent: false,
    status(value: number) { statusCode = value; return res; },
    json(value: unknown) { payload = value; return res; },
    set() { return res; },
  };
  return { res, state: () => ({ statusCode, payload }) };
}

const silentLogger: any = {
  info() {}, warn() {}, error() {}, fatal() {}, debug() {}, trace() {},
};

test('integrante normal editando un club ajeno recibe 403 FORBIDDEN', () => {
  const response = responseMock();
  globalErrorHandler(silentLogger)(
    new ClubContextError('detalle interno de autorización', 403, 'INSUFFICIENT_CLUB_ROLE'),
    {} as any,
    response.res,
    () => {},
  );
  assert.deepEqual(response.state(), {
    statusCode: 403,
    payload: {
      ok: false,
      error: 'FORBIDDEN',
      mensaje: 'No tienes permiso para realizar esta acción',
    },
  });
});

test('usuario sin autenticar continúa recibiendo 401', async () => {
  const response = responseMock();
  const req: any = {
    method: 'POST', query: { action: 'editarClub' }, body: { clubId: 'club' },
    auth: undefined,
  };
  await handleApi(req, response.res, () => {});
  assert.equal(response.state().statusCode, 401);
  assert.equal(response.state().payload.error, 'AUTHENTICATION_REQUIRED');
});

test('handleApi delega ClubContextError al mapeo central antes de responder', async () => {
  const response = responseMock();
  const expected = new ClubContextError(
    'detalle interno que no debe salir',
    403,
    'INSUFFICIENT_CLUB_ROLE',
  );
  let authReads = 0;
  const req: any = {
    method: 'POST',
    query: { action: 'editarClub' },
    body: { clubId: 'club', nombre: 'Nombre válido' },
    get auth() {
      authReads += 1;
      if (authReads === 3) throw expected;
      return { userId: 'member', userName: 'Member', sessionId: 'session' };
    },
  };
  let forwarded: unknown;
  await handleApi(req, response.res, (error?: unknown) => {
    forwarded = error;
  });
  assert.equal(forwarded, expected);
  assert.equal(response.state().statusCode, 200);
  assert.equal(response.state().payload, undefined);

  globalErrorHandler(silentLogger)(forwarded, req, response.res, () => {});
  assert.deepEqual(response.state(), {
    statusCode: 403,
    payload: {
      ok: false,
      error: 'FORBIDDEN',
      mensaje: 'No tienes permiso para realizar esta acción',
    },
  });
});

test('usuario autorizado conserva la respuesta correcta del controlador', async () => {
  const response = responseMock();
  const req: any = {
    auth: { userId: 'authorized-user' },
    body: { clubId: 'club', nombre: 'Nombre válido' },
  };
  const update = async () => ({ ok: true, clubId: 'club' });
  await handleUpdateClubWith(req, response.res, update as any);
  assert.deepEqual(response.state(), {
    statusCode: 200,
    payload: { ok: true, clubId: 'club' },
  });
});

test('un error interno inesperado continúa siendo 500 genérico', () => {
  const response = responseMock();
  globalErrorHandler(silentLogger)(new Error('detalle secreto'), {} as any, response.res, () => {});
  assert.equal(response.state().statusCode, 500);
  assert.deepEqual(response.state().payload, {
    ok: false,
    error: 'INTERNAL_ERROR',
    mensaje: 'Ha ocurrido un error interno',
  });
});

test('ClubContextError conserva estados semánticos distintos de 403', () => {
  for (const [status, code] of [[400, 'INVALID_CLUB_NAME'], [404, 'USER_NOT_FOUND'], [409, 'NO_ACTIVE_CLUB']] as const) {
    const response = responseMock();
    globalErrorHandler(silentLogger)(new ClubContextError('Mensaje seguro', status, code), {} as any, response.res, () => {});
    assert.equal(response.state().statusCode, status);
    assert.equal(response.state().payload.error, code);
  }
});
