import type { Request, Response } from 'express';
import { Router } from 'express';

import {
  handleClubvision,
  handleEnviarVotacion,
  handleMiVoto,
  handleComoVotaron,
  handleHistorialClubvision,
} from '../controllers/clubvision.controller.js';

import { handleUsuarios } from '../controllers/users.controller.js';

import {
  handleLibros,
  handleLibrosFinalizados,
  handleAnadirLibroExistente,
  handleActualizarPreferenciasLibro,
  handleIniciarLectura,
  handleActualizarEstado,
  handleActualizarValoracion,
  handleCrearLibro,
  handleQuitarLibroPendientes,
  handleEditarLibro,
  handleActualizarProgresoLectura,
  handleToggleProgressReaction,
} from '../controllers/books.controller.js';

import { handleDashboard, handleAfinidadDetalle } from '../controllers/dashboard.controller.js';

import {
  handleLecturasActivas,
  handleCrearLectura,
  handleConfiguracionLectura,
  handleComentariosLectura,
  handleGuardarComentarioLectura,
  handleResponderComentario,
  handleToggleLikeComentario,
  handleEditarComentario,
  handleEliminarComentario,
  handleEditarRespuesta,
  handleEliminarRespuesta,
  handleConversacionesLibro,
  handleMarcarConversacionVista
} from '../controllers/readings.controller.js';

import { handleRanking } from '../controllers/ranking.controller.js';

import {
  handlePerfilUsuario,
  handleActualizarFechasLectura,
  handleActualizarAvatarPerfil,
} from '../controllers/perfil.controller.js';

import {
  handleMoodClub,
  handleRegistrarMoodClub,
} from '../controllers/mood.controller.js';

import { handleTendenciasClub } from '../controllers/tendencias.controller.js';
import { ClubContextError } from '../services/club-context.service.js';
import { AuthError } from '../services/auth.service.js';
import {
  authenticateOptional,
  requireAuthentication,
} from '../middleware/auth.middleware.js';
import {
  handleActivateAccount,
  handleCompleteRegistration,
  handleChangePassword,
  handleLogin,
  handleLogout,
  handleRefresh,
  handleRequestActivation,
  handleRequestRegistration,
  handleRequestPasswordReset,
  handleResetPassword,
} from '../controllers/auth.controller.js';
import {
  handleClubInvite,
  handleCreateClub,
  handleGetClubMembers,
  handleJoinClub,
  handleLeaveClub,
  handleMyClubs,
  handleSelectClub,
  handleUpdateClub,
} from '../controllers/clubs.controller.js';
import { handleGeneralDashboard } from '../controllers/general-dashboard.controller.js';
import { handleLibrosPorAutor } from '../controllers/general-dashboard.controller.js';
import {
  handleGeneralCatalog,
  handleAddSeriesCatalogVolume,
  handleImportCatalogBook,
  handleSearchGeneralCatalog,
  handleUpdateSeriesPublicationStatus,
  handleUpdateSeriesVolumeOrder,
} from '../controllers/catalog.controller.js';
import {
  handleConfirmGoodreadsImport,
  handlePreviewGoodreadsImport,
} from '../controllers/goodreads-import.controller.js';
import { GoodreadsImportError } from '../services/goodreads-import.service.js';
import { handleEliminarNotificacion, handleGetNotificaciones, handleMarcarLeida, handleMarcarTodasLeidas } from '../controllers/notifications.controller.js';
import { handleGetSeriesOverrides, handleRemoveSeriesOverride, handleSetSeriesOverride } from '../controllers/series-override.controller.js';
import { handleGetHiddenSeries, handleHideSeries, handleShowSeries } from '../controllers/hidden-user-series.controller.js';
import { HiddenUserSeriesError } from '../services/hidden-user-series.service.js';

export const apiRouter = Router();

const PUBLIC_AUTH_ACTIONS = new Set([
  'solicitarActivacion',
  'activarCuenta',
  'solicitarRegistro',
  'completarRegistro',
  'login',
  'solicitarResetPassword',
  'resetPassword',
  'refreshToken',
]);
const POST_ONLY_ACTIONS = new Set([
  ...PUBLIC_AUTH_ACTIONS,
  'logout',
  'cambiarPassword',
  'crearClub',
  'unirseClub',
  'seleccionarClub',
  'invitacionClub',
  'importarLibroCatalogo',
  'vincularVolumenSaga',
  'actualizarNumeroVolumenSaga',
  'actualizarEstadoEditorialSaga',
  'setSeriesOverride',
  'removeSeriesOverride',
  'ocultarSaga',
  'mostrarSaga',
  'eliminarNotificacion',
  'previsualizarImportacionGoodreads',
  'confirmarImportacionGoodreads',
]);

async function handleApi(req: Request, res: Response) {
  try {
    const action = String(req.query.action || '');
    if (
      POST_ONLY_ACTIONS.has(action) &&
      req.method !== 'POST'
    ) {
      return res.status(405).json({
        ok: false,
        error: 'METHOD_NOT_ALLOWED',
        mensaje: 'Esta acción solo admite POST',
      });
    }

    if (
      process.env.AUTH_REQUIRE_ACCESS_TOKEN === 'true' &&
      !PUBLIC_AUTH_ACTIONS.has(action) &&
      !req.auth
    ) {
      return res.status(401).json({
        ok: false,
        error: 'AUTHENTICATION_REQUIRED',
        mensaje: 'Necesitas iniciar sesión',
      });
    }

    if (PUBLIC_AUTH_ACTIONS.has(action) || req.auth) {
      res.set('Cache-Control', 'no-store');
    }

    const claimedUser = String(
      req.body?.usuario ?? req.query.usuario ?? '',
    ).trim();

    if (
      req.auth &&
      claimedUser &&
      claimedUser !== req.auth.userName
    ) {
      return res.status(403).json({
        ok: false,
        error: 'IDENTITY_MISMATCH',
        mensaje: 'La usuaria no coincide con la sesión',
      });
    }

    switch (action) {
      case 'solicitarActivacion':
        return handleRequestActivation(req, res);

      case 'activarCuenta':
        return handleActivateAccount(req, res);

      case 'solicitarRegistro':
        return handleRequestRegistration(req, res);

      case 'completarRegistro':
        return handleCompleteRegistration(req, res);

      case 'login':
        return handleLogin(req, res);

      case 'solicitarResetPassword':
        return handleRequestPasswordReset(req, res);

      case 'resetPassword':
        return handleResetPassword(req, res);

      case 'refreshToken':
        return handleRefresh(req, res);

      case 'logout':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleLogout(req, res);

      case 'cambiarPassword':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleChangePassword(req, res);

      case 'misClubes':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleMyClubs(req, res);

      case 'dashboardGeneral':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleGeneralDashboard(req, res);

      case 'seriesOverrides':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetSeriesOverrides(req, res);

      case 'sagasOcultas':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetHiddenSeries(req, res);

      case 'setSeriesOverride':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleSetSeriesOverride(req, res);

      case 'removeSeriesOverride':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleRemoveSeriesOverride(req, res);

      case 'ocultarSaga':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleHideSeries(req, res);

      case 'mostrarSaga':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleShowSeries(req, res);

      case 'notificaciones':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetNotificaciones(req, res);

      case 'marcarLeida':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleMarcarLeida(req, res);

      case 'marcarTodasLeidas':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleMarcarTodasLeidas(req, res);

      case 'eliminarNotificacion':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleEliminarNotificacion(req, res);

      case 'librosPorAutor':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleLibrosPorAutor(req, res);

      case 'catalogoGeneral':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleGeneralCatalog(req, res);

      case 'buscarCatalogoGeneral':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleSearchGeneralCatalog(req, res);

      case 'importarLibroCatalogo':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleImportCatalogBook(req, res);

      case 'previsualizarImportacionGoodreads':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handlePreviewGoodreadsImport(req, res);

      case 'confirmarImportacionGoodreads':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleConfirmGoodreadsImport(req, res);

      case 'vincularVolumenSaga':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleAddSeriesCatalogVolume(req, res);

      case 'actualizarNumeroVolumenSaga':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleUpdateSeriesVolumeOrder(req, res);

      case 'actualizarEstadoEditorialSaga':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleUpdateSeriesPublicationStatus(req, res);

      case 'crearClub':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleCreateClub(req, res);

      case 'unirseClub':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleJoinClub(req, res);

      case 'seleccionarClub':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleSelectClub(req, res);

      case 'invitacionClub':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleClubInvite(req, res);

      case 'salirClub':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleLeaveClub(req, res);

      case 'editarClub':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleUpdateClub(req, res);

      case 'miembrosClub':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleGetClubMembers(req, res);

      case 'usuarios':
        return handleUsuarios(req, res);

      case 'dashboard':
        return handleDashboard(req, res);

      case 'afinidadDetalle':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleAfinidadDetalle(req, res);

      case 'libros':
        return handleLibros(req, res);

      case 'librosFinalizados':
        return handleLibrosFinalizados(req, res);

      case 'crearLibro':
        return handleCrearLibro(req, res);

      case 'editarLibro':
        return handleEditarLibro(req, res);  

      case 'anadirLibroExistente':
        return handleAnadirLibroExistente(req, res);

      case 'actualizarPreferenciasLibro':
        return handleActualizarPreferenciasLibro(req, res);
      
      case 'quitarLibroPendientes':
        return handleQuitarLibroPendientes(req, res);  

      case 'iniciarLectura':
        return handleIniciarLectura(req, res);

      case 'actualizarEstado':
        return handleActualizarEstado(req, res);

      case 'actualizarProgresoLectura':
        return handleActualizarProgresoLectura(req, res);

      case 'toggleProgressReaction':
        return handleToggleProgressReaction(req, res);

      case 'actualizarValoracion':
        return handleActualizarValoracion(req, res);

      case 'clubvision':
        return handleClubvision(req, res);

      case 'enviarVotacion':
        return handleEnviarVotacion(req, res);

      case 'miVoto':
        return handleMiVoto(req, res);

      case 'comoVotaron':
        return handleComoVotaron(req, res);

      case 'historialClubvision':
        return handleHistorialClubvision(req, res);

      case 'lecturasActivas':
        return handleLecturasActivas(req, res);

      case 'crearLectura':
        return handleCrearLectura(req, res);

      case 'configuracionLectura':
        return handleConfiguracionLectura(req, res);  

      case 'comentariosLectura':
        return handleComentariosLectura(req, res);  

      case 'guardarComentarioLectura':
        return handleGuardarComentarioLectura(req, res);  
      
      case 'responderComentario':
        return handleResponderComentario(req, res);  

      case 'toggleLikeComentario':
        return handleToggleLikeComentario(req, res);

      case 'editarComentario':
        return handleEditarComentario(req, res);

      case 'eliminarComentario':
        return handleEliminarComentario(req, res);  

      case 'editarRespuesta':
        return handleEditarRespuesta(req, res);

      case 'eliminarRespuesta':
        return handleEliminarRespuesta(req, res);  
      
      case 'conversacionesLibro':
        return handleConversacionesLibro(req, res);  

      case 'ranking':
        return handleRanking(req, res);  

      case 'perfilUsuario':
        return handlePerfilUsuario(req, res);  

      case 'actualizarFechasLectura':
        return handleActualizarFechasLectura(req, res);

      case 'actualizarAvatarPerfil':
        return handleActualizarAvatarPerfil(req, res);  

      case 'moodClub':
        return handleMoodClub(req, res);  

      case 'registrarMoodClub':
        return handleRegistrarMoodClub(req, res);

      case 'tendenciasClub':
        return handleTendenciasClub(req, res);  
      
      case 'marcarConversacionVista':
        return handleMarcarConversacionVista(req, res);  

      default:
        return res.status(400).json({
          error: 'Acción no válida',
          action,
        });
    }
  } catch (error) {
    console.error(error);

    if (
      error instanceof ClubContextError ||
      error instanceof AuthError ||
      error instanceof GoodreadsImportError ||
      error instanceof HiddenUserSeriesError
    ) {
      return res.status(error.statusCode).json({
        ok: false,
        error: error.code,
        mensaje: error.message,
      });
    }

    return res.status(500).json({
      error: 'Error interno del servidor',
    });
  }
}

apiRouter.use(authenticateOptional);
apiRouter.get('/', handleApi);
apiRouter.post('/', handleApi);
