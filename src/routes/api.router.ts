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
  handleIniciarLectura,
  handleActualizarEstado,
  handleActualizarValoracion,
  handleCrearLibro,
  handleQuitarLibroPendientes,
  handleEditarLibro,
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

export const apiRouter = Router();

async function handleApi(req: Request, res: Response) {
  try {
    const action = String(req.query.action || '');

    switch (action) {
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
      
      case 'quitarLibroPendientes':
        return handleQuitarLibroPendientes(req, res);  

      case 'iniciarLectura':
        return handleIniciarLectura(req, res);

      case 'actualizarEstado':
        return handleActualizarEstado(req, res);

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

    return res.status(500).json({
      error: 'Error interno del servidor',
    });
  }
}

apiRouter.get('/', handleApi);
apiRouter.post('/', handleApi);
