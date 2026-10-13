import { randomInt } from 'node:crypto';

/// Sin I, O, 0 ni 1 para que el código se lea y se escriba sin dudas.
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LONGITUD_CODIGO = 8;

export const MAX_SOLICITUDES_PENDIENTES = 30;
export const MAX_SOLICITUDES_POR_DIA = 20;
export const MAX_BUSQUEDAS_POR_MINUTO = 30;
export const MIN_LETRAS_BUSQUEDA = 3;
export const MAX_RESULTADOS_BUSQUEDA = 15;
export const MAX_RECOMENDADAS_POR_LLAMADA = 20;
export const MAX_RECOMENDACIONES_POR_DIA = 40;
export const MAX_LETRAS_MENSAJE_RECOMENDACION = 140;
export const MAX_LETRAS_COMENTARIO_PROGRESO = 300;
/// Personas en una lectura conjunta entre amistades (por ahora, parejas).
export const MAX_PERSONAS_LECTURA_AMISTADES = 2;
export const MAX_LECTURAS_AMISTADES_ABIERTAS = 5;
export const MAX_COMENTARIOS_PROGRESO_POR_MINUTO = 8;
export const MAX_COMENTARIOS_PROGRESO_POR_DIA = 60;
export const MAX_COMENTARIOS_PROGRESO_VISIBLES = 50;

export function generarCodigoAmistad(aleatorio: (max: number) => number = randomInt) {
  let codigo = '';
  for (let i = 0; i < LONGITUD_CODIGO; i++) {
    codigo += ALFABETO_CODIGO[aleatorio(ALFABETO_CODIGO.length)]!;
  }
  return codigo;
}

/// Lo que escribe quien recibe el código («abcd-efgh», con espacios…) a su
/// forma guardada. Devuelve null si no puede ser un código válido.
export function normalizarCodigoAmistad(entrada: unknown): string | null {
  const limpio = String(entrada ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (limpio.length !== LONGITUD_CODIGO) return null;
  for (const letra of limpio) {
    if (!ALFABETO_CODIGO.includes(letra)) return null;
  }
  return limpio;
}

/// «ABCDEFGH» → «ABCD-EFGH» para enseñarlo.
export function formatearCodigoAmistad(codigo: string) {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

export type EstadoAmistad = 'NINGUNA' | 'ENVIADA' | 'RECIBIDA' | 'AMIGA';

/// Estado de la relación entre yo y otra persona, a partir de la fila (si la hay).
export function estadoDeAmistad(
  yo: string,
  fila: { requesterId: string; status: 'PENDING' | 'ACCEPTED' } | undefined | null,
): EstadoAmistad {
  if (!fila) return 'NINGUNA';
  if (fila.status === 'ACCEPTED') return 'AMIGA';
  return fila.requesterId === yo ? 'ENVIADA' : 'RECIBIDA';
}

/// Limitador sencillo en memoria: como mucho `max` usos por minuto y persona.
export function crearLimitador(max: number, ventanaMs = 60_000) {
  const usos = new Map<string, number[]>();
  return (clave: string, ahora = Date.now()) => {
    const recientes = (usos.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
    if (recientes.length >= max) {
      usos.set(clave, recientes);
      return false;
    }
    recientes.push(ahora);
    usos.set(clave, recientes);
    return true;
  };
}

/// Mensaje personal opcional de una recomendación: una línea, sin espacios
/// de más y con tope de longitud. Devuelve '' si no hay nada que enseñar.
export function limpiarMensajeRecomendacion(entrada: unknown): string {
  return String(entrada ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LETRAS_MENSAJE_RECOMENDACION)
    .trim();
}

/// Comentario en el progreso de una lectura: una sola línea larga, sin espacios
/// de más y con tope. Devuelve '' si no queda nada que publicar.
export function limpiarComentarioProgreso(entrada: unknown): string {
  return String(entrada ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_LETRAS_COMENTARIO_PROGRESO)
    .trim();
}
