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
} from '../controllers/books.controller.js';

import { handleDashboard } from '../controllers/dashboard.controller.js';

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
  handleJoinClub,
  handleMyClubs,
  handleSelectClub,
} from '../controllers/clubs.controller.js';
import { handleGeneralDashboard } from '../controllers/general-dashboard.controller.js';

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

      case 'usuarios':
        return handleUsuarios(req, res);

      case 'dashboard':
        return handleDashboard(req, res);

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
      error instanceof AuthError
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
