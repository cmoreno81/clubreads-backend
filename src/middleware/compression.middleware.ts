import compression from 'compression';
import type { RequestHandler } from 'express';

/// Comprime (gzip) las respuestas que no son diminutas. Las listas de la
/// biblioteca pesan megas en JSON y se reducen unas 10 veces; la app (dart:io)
/// las descomprime sola. Se salta lo que ya viene comprimido o lo que pida
/// no comprimirse con la cabecera `x-no-compression`.
export function createCompressionMiddleware(): RequestHandler {
  return compression({ threshold: 1024 });
}
