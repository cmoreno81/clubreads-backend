import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import {
  POST_ONLY_ACTIONS,
  enforceActionMethod,
  handleApi,
} from '../src/routes/api.router.js';

const mutationHandlers: Record<string, string> = {
  solicitarActivacion: 'handleRequestActivation',
  activarCuenta: 'handleActivateAccount',
  solicitarRegistro: 'handleRequestRegistration',
  completarRegistro: 'handleCompleteRegistration',
  login: 'handleLogin',
  solicitarResetPassword: 'handleRequestPasswordReset',
  resetPassword: 'handleResetPassword',
  refreshToken: 'handleRefresh',
  logout: 'handleLogout',
  cambiarPassword: 'handleChangePassword',
  setSeriesOverride: 'handleSetSeriesOverride',
  removeSeriesOverride: 'handleRemoveSeriesOverride',
  ocultarSaga: 'handleHideSeries',
  mostrarSaga: 'handleShowSeries',
  eliminarSaga: 'handleRemoveSeries',
  marcarLeida: 'handleMarcarLeida',
  marcarTodasLeidas: 'handleMarcarTodasLeidas',
  eliminarNotificacion: 'handleEliminarNotificacion',
  eliminarTodasNotificaciones: 'handleEliminarTodasNotificaciones',
  importarLibroCatalogo: 'handleImportCatalogBook',
  previsualizarImportacionGoodreads: 'handlePreviewGoodreadsImport',
  confirmarImportacionGoodreads: 'handleConfirmGoodreadsImport',
  vincularVolumenSaga: 'handleAddSeriesCatalogVolume',
  actualizarNumeroVolumenSaga: 'handleUpdateSeriesVolumeOrder',
  actualizarEstadoEditorialSaga: 'handleUpdateSeriesPublicationStatus',
  crearClub: 'handleCreateClub',
  crearEspacioPersonal: 'handleCrearEspacioPersonal',
  doCheckin: 'handleDoCheckin',
  unirseClub: 'handleJoinClub',
  seleccionarClub: 'handleSelectClub',
  invitacionClub: 'handleClubInvite',
  salirClub: 'handleLeaveClub',
  editarClub: 'handleUpdateClub',
  crearLibro: 'handleCrearLibro',
  editarLibro: 'handleEditarLibro',
  anadirLibroExistente: 'handleAnadirLibroExistente',
  actualizarPreferenciasLibro: 'handleActualizarPreferenciasLibro',
  quitarLibroPendientes: 'handleQuitarLibroPendientes',
  iniciarLectura: 'handleIniciarLectura',
  actualizarEstado: 'handleActualizarEstado',
  actualizarProgresoLectura: 'handleActualizarProgresoLectura',
  toggleProgressReaction: 'handleToggleProgressReaction',
  actualizarValoracion: 'handleActualizarValoracion',
  actualizarPaginaLibrary: 'handleActualizarPaginaLibrary',
  enviarVotacion: 'handleEnviarVotacion',
  crearLectura: 'handleCrearLectura',
  guardarComentarioLectura: 'handleGuardarComentarioLectura',
  responderComentario: 'handleResponderComentario',
  toggleLikeComentario: 'handleToggleLikeComentario',
  editarComentario: 'handleEditarComentario',
  eliminarComentario: 'handleEliminarComentario',
  editarRespuesta: 'handleEditarRespuesta',
  eliminarRespuesta: 'handleEliminarRespuesta',
  marcarConversacionVista: 'handleMarcarConversacionVista',
  actualizarFechasLectura: 'handleActualizarFechasLectura',
  actualizarAvatarPerfil: 'handleActualizarAvatarPerfil',
  toggleFavorito: 'handleToggleFavorito',
  reemplazarFavorito: 'handleReemplazarFavorito',
  registrarMoodClub: 'handleRegistrarMoodClub',
  saveUserSeriesOrder: 'handleSaveUserSeriesOrder',
  setReadingChallenge: 'handleSetChallenge',
};

function mockRequest(method: string, action: string) {
  return {
    body: {},
    method,
    query: { action },
  } as unknown as Request;
}

function mockResponse() {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const res = {
    set(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return res;
    },
    status(value: number) {
      statusCode = value;
      return res;
    },
    json(value: unknown) {
      body = value;
      return res;
    },
  } as unknown as Response;

  return { res, state: () => ({ body, headers, statusCode }) };
}

const routerSource = readFileSync(
  new URL('../src/routes/api.router.ts', import.meta.url),
  'utf8',
);

test('el inventario POST-only contiene exactamente todas las acciones mutadoras', () => {
  assert.deepEqual(
    [...POST_ONLY_ACTIONS].sort(),
    Object.keys(mutationHandlers).sort(),
  );
});

for (const [action, handler] of Object.entries(mutationHandlers)) {
  test(`${action}: GET devuelve 405 y POST alcanza su rama`, () => {
    const getResponse = mockResponse();
    enforceActionMethod(action, mockRequest('GET', action), getResponse.res);

    assert.equal(getResponse.state().statusCode, 405);
    assert.equal(getResponse.state().headers.get('allow'), 'POST');
    assert.deepEqual(getResponse.state().body, {
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
      mensaje: 'Esta acción solo admite POST',
    });

    const postResponse = mockResponse();
    assert.equal(
      enforceActionMethod(action, mockRequest('POST', action), postResponse.res),
      null,
    );
    assert.match(
      routerSource,
      new RegExp(`case '${action}':[\\s\\S]*?return ${handler}\\(req, res\\)`),
    );
  });
}

test('una acción mutadora privada por POST sin token sigue devolviendo 401', async () => {
  const response = mockResponse();
  await handleApi(mockRequest('POST', 'crearLibro'), response.res, () => {});

  assert.equal(response.state().statusCode, 401);
  assert.deepEqual(response.state().body, {
    ok: false,
    error: 'AUTHENTICATION_REQUIRED',
    mensaje: 'Necesitas iniciar sesión',
  });
});

test('los controladores mutadores no obtienen valores desde req.query', () => {
  const controllers: Record<string, string[]> = {
    'auth.controller.ts': [],
    'books.controller.ts': [
      'handleActualizarProgresoLectura',
      'handleToggleProgressReaction',
      'handleCrearLibro',
      'handleAnadirLibroExistente',
      'handleActualizarPreferenciasLibro',
      'handleIniciarLectura',
      'handleActualizarValoracion',
      'handleActualizarEstado',
      'handleQuitarLibroPendientes',
      'handleEditarLibro',
      'handleActualizarPaginaLibrary',
    ],
    'readings.controller.ts': [
      'handleCrearLectura',
      'handleGuardarComentarioLectura',
      'handleResponderComentario',
      'handleToggleLikeComentario',
      'handleEditarComentario',
      'handleEliminarComentario',
      'handleEditarRespuesta',
      'handleEliminarRespuesta',
      'handleMarcarConversacionVista',
    ],
    'clubvision.controller.ts': ['handleEnviarVotacion'],
    'perfil.controller.ts': [
      'handleActualizarFechasLectura',
      'handleActualizarAvatarPerfil',
    ],
    'mood.controller.ts': ['handleRegistrarMoodClub'],
    'clubs.controller.ts': [
      'handleCreateClub',
      'handleJoinClub',
      'handleSelectClub',
      'handleClubInvite',
      'handleLeaveClub',
      'handleUpdateClub',
    ],
  };

  for (const [file, handlers] of Object.entries(controllers)) {
    const source = readFileSync(
      new URL(`../src/controllers/${file}`, import.meta.url),
      'utf8',
    );
    if (file === 'auth.controller.ts') {
      assert.doesNotMatch(source, /req\.query/);
      continue;
    }

    for (const handler of handlers) {
      const implementation = source.match(
        new RegExp(`export async function ${handler}\\b[\\s\\S]*?(?=\\nexport async function|$)`),
      )?.[0];
      assert.ok(implementation, `${handler} no encontrado`);
      assert.doesNotMatch(implementation, /req\.query/, handler);
    }
  }
});

test('la identidad de los controladores no se obtiene del body ni de query', () => {
  const sources = readFileSync(
    new URL('../src/middleware/auth.middleware.ts', import.meta.url),
    'utf8',
  );
  assert.match(sources, /return req\.auth\?\.userName \?\? ''/);
  assert.doesNotMatch(routerSource, /claimedUser|IDENTITY_MISMATCH/);
});

test('CORS continúa permitiendo POST y preflight OPTIONS', () => {
  const securitySource = readFileSync(
    new URL('../src/middleware/http-security.middleware.ts', import.meta.url),
    'utf8',
  );
  assert.match(securitySource, /methods: \['GET', 'POST', 'OPTIONS'\]/);
});
