import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import {
  handleClubvision,
  handleEnviarVotacion,
  handleMiVoto,
  handleComoVotaron,
  handleHistorialClubvision,
  handleGetClubvisionEstadisticas,
} from '../controllers/clubvision.controller.js';

import { handleUsuarios } from '../controllers/users.controller.js';

import {
  handleGetLibroPorId,
  handleLibros,
  handleLibrosFinalizados,
  handleLibrosFinalizadosTodos,
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
  handleActualizarPaginaLibrary,
  handleExportBiblioteca,
  handleEditarFechaInicioLectura,
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
  handleGetAchievements,
  handleGetRecentClubAchievements,
} from '../controllers/achievements.controller.js';

import {
  handlePerfilUsuario,
  handleActualizarFechasLectura,
  handleActualizarAvatarPerfil,
  handleActualizarFrasePerfil,
  handleToggleFavorito,
  handleReemplazarFavorito,
  handleGetFavoritos,
  handleGetFavoritosDelClub,
  handleGuardarPersonalidadLectora,
} from '../controllers/perfil.controller.js';

import {
  handleMoodClub,
  handleRegistrarMoodClub,
} from '../controllers/mood.controller.js';

import { handleTendenciasClub } from '../controllers/tendencias.controller.js';
import {
  authenticateOptional,
  requireAuthentication,
} from '../middleware/auth.middleware.js';
import { publicAuthRateLimiter } from '../middleware/rate-limit.middleware.js';
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
  handleCrearEspacioPersonal,
  handleGetClubMembers,
  handleGetPersonalidadesClub,
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
import { handleEliminarNotificacion, handleEliminarTodasNotificaciones, handleGetNotificaciones, handleMarcarLeida, handleMarcarTodasLeidas } from '../controllers/notifications.controller.js';
import { handleGetSeriesOverrides, handleRemoveSeriesOverride, handleSetSeriesOverride } from '../controllers/series-override.controller.js';
import { handleGetHiddenSeries, handleHideSeries, handleShowSeries, handleRemoveSeries, } from '../controllers/hidden-user-series.controller.js';
import { handleSaveUserSeriesOrder } from '../controllers/user-series-order.controller.js';
import {
  handleGetClubChallenges,
  handleSetChallenge,
} from '../controllers/reading-challenge.controller.js';
import {
  handleDoCheckin,
  handleGetCheckinHistory,
  handleGetHeatmap,
  handleGetWrapped,
} from '../controllers/checkin.controller.js';
import { validateActionInput } from '../validation/api-validation.js';
import { handleChooseAnnualBookOfYear, handleChooseBookOfYearDuel, handleGetClubBooksOfYear, handleGetMyBookOfYear, handleGetPublicBookOfYear, handleSaveMonthlyBookOfYear } from '../controllers/book-of-year.controller.js';
import { handleReactionDetails } from '../controllers/reaction-details.controller.js';
import { handleEnviarFeedback } from '../controllers/feedback.controller.js';
import { handleCancelClubBookOfYear, handleCloseClubBookOfYearQualifying, handleCloseClubBookOfYearRound, handleGetClubBookOfYear, handleGetClubBookOfYearHistory, handleLinkClubBookOfYearHistoricalCandidate, handleOpenClubBookOfYearRound, handleOpenClubBookOfYearVoting, handlePrepareClubBookOfYear, handleStartClubBookOfYear, handleSyncClubBookOfYear, handleVoteClubBookOfYearDuel, handleVoteClubBookOfYearQualifying } from '../controllers/club-book-of-year.controller.js';
import {
  handleGetWishlist,
  handleAddWishlistItem,
  handleUpdateWishlistItem,
  handleDeleteWishlistItem,
  handleMarkPurchased,
  handleUnmarkPurchased,
  handleGetClubWishlist,
} from '../controllers/wishlist.controller.js';
import { handleGetUpcomingReleases } from '../controllers/upcoming-releases.controller.js';
import { handleGetNewReleases } from '../controllers/new-releases.controller.js';
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
export const POST_ONLY_ACTIONS = new Set([
  ...PUBLIC_AUTH_ACTIONS,
  'logout',
  'cambiarPassword',
  'setSeriesOverride',
  'removeSeriesOverride',
  'ocultarSaga',
  'mostrarSaga',
  'eliminarSaga',
  'marcarLeida',
  'marcarTodasLeidas',
  'eliminarNotificacion',
  'eliminarTodasNotificaciones',
  'importarLibroCatalogo',
  'previsualizarImportacionGoodreads',
  'confirmarImportacionGoodreads',
  'vincularVolumenSaga',
  'actualizarNumeroVolumenSaga',
  'actualizarEstadoEditorialSaga',
  'crearClub',
  'crearEspacioPersonal',
  'doCheckin',
  'unirseClub',
  'seleccionarClub',
  'invitacionClub',
  'salirClub',
  'editarClub',
  'crearLibro',
  'editarLibro',
  'anadirLibroExistente',
  'actualizarPreferenciasLibro',
  'quitarLibroPendientes',
  'iniciarLectura',
  'actualizarEstado',
  'actualizarProgresoLectura',
  'toggleProgressReaction',
  'actualizarValoracion',
  'actualizarPaginaLibrary',
  'enviarVotacion',
  'crearLectura',
  'guardarComentarioLectura',
  'responderComentario',
  'toggleLikeComentario',
  'editarComentario',
  'eliminarComentario',
  'editarRespuesta',
  'eliminarRespuesta',
  'marcarConversacionVista',
  'actualizarFechasLectura',
  'actualizarAvatarPerfil',
  'actualizarFrasePerfil',
  'enviarFeedback',
  'guardarPersonalidadLectora',
  'toggleFavorito',
  'reemplazarFavorito',
  'registrarMoodClub',
  'saveUserSeriesOrder',
  'setReadingChallenge',
  'guardarSeleccionLibroDelAnio',
  'elegirDueloLibroDelAnio',
  'elegirLibroDelAnio',
  'iniciarLibroDelAnioClub',
  'votarClasificacionLibroDelAnioClub',
  'cerrarClasificacionLibroDelAnioClub',
  'abrirRondaLibroDelAnioClub',
  'votarDueloLibroDelAnioClub',
  'cerrarRondaLibroDelAnioClub',
  'cancelarLibroDelAnioClub',
  'vincularCandidataHistoricaLibroDelAnioClub',
  'sincronizarCandidatasLibroDelAnioClub',
  'abrirVotacionLibroDelAnioClub',
]);

export function enforceActionMethod(
  action: string,
  req: Request,
  res: Response,
) {
  if (!POST_ONLY_ACTIONS.has(action) || req.method === 'POST') return null;

  return res.status(405).set('Allow', 'POST').json({
    ok: false,
    error: 'METHOD_NOT_ALLOWED',
    mensaje: 'Esta acción solo admite POST',
  });
}

export async function handleApi(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const action = String(req.query.action || '');
    const methodError = enforceActionMethod(action, req, res);
    if (methodError) return methodError;

    if (!PUBLIC_AUTH_ACTIONS.has(action) && !req.auth) {
      return res.status(401).json({
        ok: false,
        error: 'AUTHENTICATION_REQUIRED',
        mensaje: 'Necesitas iniciar sesión',
      });
    }

    const validationError = validateActionInput(action, req, res);
    if (validationError) return validationError;

    if (PUBLIC_AUTH_ACTIONS.has(action) || req.auth) {
      res.set('Cache-Control', 'no-store');
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

      case 'eliminarSaga':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleRemoveSeries(req, res);  

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

      case 'eliminarTodasNotificaciones':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleEliminarTodasNotificaciones(req, res);  

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

      case 'crearEspacioPersonal':
        if (!req.auth) {
          return requireAuthentication(req, res, () => {});
        }
        return handleCrearEspacioPersonal(req, res);

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

      case 'librosFinalizadosTodos':
        return handleLibrosFinalizadosTodos(req, res);

      case 'libroPorId':
        return handleGetLibroPorId(req, res);

      case 'exportBiblioteca':
        return handleExportBiblioteca(req, res);

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

      case 'editarFechaInicioLectura':
        return handleEditarFechaInicioLectura(req, res);

      case 'actualizarProgresoLectura':
        return handleActualizarProgresoLectura(req, res);

      case 'toggleProgressReaction':
        return handleToggleProgressReaction(req, res);

      case 'detalleReacciones':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleReactionDetails(req, res);

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

      case 'clubvisionEstadisticas':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetClubvisionEstadisticas(req, res);

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

      case 'favoritosUsuario':
        return handleGetFavoritos(req, res);

      case 'favoritosDelClub':
        return handleGetFavoritosDelClub(req, res);

      case 'toggleFavorito':
        return handleToggleFavorito(req, res);

      case 'reemplazarFavorito':
        return handleReemplazarFavorito(req, res);

      case 'miLibroDelAnio':
        return handleGetMyBookOfYear(req, res);

      case 'guardarSeleccionLibroDelAnio':
        return handleSaveMonthlyBookOfYear(req, res);

      case 'elegirDueloLibroDelAnio':
        return handleChooseBookOfYearDuel(req, res);

      case 'elegirLibroDelAnio':
        return handleChooseAnnualBookOfYear(req, res);

      case 'libroDelAnioPublico':
        return handleGetPublicBookOfYear(req, res);

      case 'librosDelAnioClub':
        return handleGetClubBooksOfYear(req, res);

      case 'libroDelAnioClub':
        return handleGetClubBookOfYear(req, res);
      case 'prepararLibroDelAnioClub':
        return handlePrepareClubBookOfYear(req, res);
      case 'iniciarLibroDelAnioClub':
        return handleStartClubBookOfYear(req, res);
      case 'votarClasificacionLibroDelAnioClub':
        return handleVoteClubBookOfYearQualifying(req, res);
      case 'cerrarClasificacionLibroDelAnioClub':
        return handleCloseClubBookOfYearQualifying(req, res);
      case 'abrirRondaLibroDelAnioClub':
        return handleOpenClubBookOfYearRound(req, res);
      case 'votarDueloLibroDelAnioClub':
        return handleVoteClubBookOfYearDuel(req, res);
      case 'cerrarRondaLibroDelAnioClub':
        return handleCloseClubBookOfYearRound(req, res);
      case 'historialLibroDelAnioClub':
        return handleGetClubBookOfYearHistory(req, res);
      case 'cancelarLibroDelAnioClub':
        return handleCancelClubBookOfYear(req, res);
      case 'vincularCandidataHistoricaLibroDelAnioClub':
        return handleLinkClubBookOfYearHistoricalCandidate(req, res);
      case 'sincronizarCandidatasLibroDelAnioClub':
        return handleSyncClubBookOfYear(req, res);
      case 'abrirVotacionLibroDelAnioClub':
        return handleOpenClubBookOfYearVoting(req, res);

      case 'achievements':
        return handleGetAchievements(req, res);

      case 'clubAchievementsRecent':
        return handleGetRecentClubAchievements(req, res);

      case 'actualizarFechasLectura':
        return handleActualizarFechasLectura(req, res);

      case 'actualizarAvatarPerfil':
        return handleActualizarAvatarPerfil(req, res);

      case 'actualizarFrasePerfil':
        return handleActualizarFrasePerfil(req, res);

      case 'guardarPersonalidadLectora':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGuardarPersonalidadLectora(req, res);

      case 'enviarFeedback':
        return handleEnviarFeedback(req, res);

      case 'getPersonalidadesClub':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetPersonalidadesClub(req, res);

      case 'moodClub':
        return handleMoodClub(req, res);  

      case 'registrarMoodClub':
        return handleRegistrarMoodClub(req, res);

      case 'tendenciasClub':
        return handleTendenciasClub(req, res);  
      
      case 'marcarConversacionVista':
        return handleMarcarConversacionVista(req, res);  

      case 'saveUserSeriesOrder':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleSaveUserSeriesOrder(req, res);  

      case 'getClubChallenges':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetClubChallenges(req, res);

      case 'setReadingChallenge':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleSetChallenge(req, res);

      case 'actualizarPaginaLibrary':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleActualizarPaginaLibrary(req, res);

      case 'doCheckin':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleDoCheckin(req, res);

      case 'historialCheckin':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetCheckinHistory(req, res);

      case 'mapaCalor':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetHeatmap(req, res);

      case 'wrappedAnual':
        if (!req.auth) return requireAuthentication(req, res, () => {});
        return handleGetWrapped(req, res);

      default:
        return res.status(400).json({
          error: 'Acción no válida',
          action,
        });
    }
  } catch (error) {
    return next(error);
  }
}

apiRouter.use(publicAuthRateLimiter);
apiRouter.use(authenticateOptional);
apiRouter.get('/achievements', requireAuthentication, handleGetAchievements);
apiRouter.get(
  '/club/achievements/recent',
  requireAuthentication,
  handleGetRecentClubAchievements,
);

// ── Wishlist (lista de adquisición) ──────────────────────────────────────
apiRouter.get('/wishlist', requireAuthentication, handleGetWishlist);
apiRouter.get('/books/upcoming', requireAuthentication, handleGetUpcomingReleases);
apiRouter.get('/books/new-releases', requireAuthentication, handleGetNewReleases);
apiRouter.post('/wishlist', requireAuthentication, handleAddWishlistItem);
apiRouter.patch('/wishlist/:id', requireAuthentication, handleUpdateWishlistItem);
apiRouter.delete('/wishlist/:id', requireAuthentication, handleDeleteWishlistItem);
apiRouter.post('/wishlist/:id/purchased', requireAuthentication, handleMarkPurchased);
apiRouter.delete('/wishlist/:id/purchased', requireAuthentication, handleUnmarkPurchased);
apiRouter.get('/club/wishlist', requireAuthentication, handleGetClubWishlist);
apiRouter.get('/', handleApi);
apiRouter.post('/', handleApi);
apiRouter.post(
  '/series/order',
  requireAuthentication,
  handleSaveUserSeriesOrder,
);
