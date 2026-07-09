export declare function getLecturasActivas(): Promise<{
    libro: string;
    lectoras: number;
    configurada: boolean;
    comentarios: number;
    ultimaActividad: string;
    tipo: string;
    estado: string;
}[]>;
export declare function crearLectura(data: {
    libro: string;
    capitulos: number;
    prologo: boolean;
    epilogo: boolean;
    tipo: string;
}): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function getConfiguracionLectura(libro: string): Promise<{
    capitulos: number;
    prologo: boolean;
    epilogo: boolean;
    capitulosDisponibles: {
        nombre: string;
        comentarios: number;
        likes: number;
        ultimaActividad: string;
    }[];
}>;
export declare function getComentariosLectura(libro: string, capitulo: string, usuarioActual: string): Promise<{
    ok: boolean;
    capitulo: string;
    comentarios: {
        id: string;
        libro: string;
        capitulo: string;
        usuario: string;
        fecha: string;
        comentario: string;
        likes: number;
        editado: boolean;
        eliminado: boolean;
        miLike: boolean;
        esMio: boolean;
        respuestas: {
            id: string;
            comentarioId: string;
            usuario: string;
            fecha: string;
            respuesta: string;
            likes: number;
            miLike: boolean;
            editado: boolean;
            eliminado: boolean;
            esMia: boolean;
        }[];
    }[];
}>;
export declare function enviarComentarioLectura(data: {
    libro: string;
    capitulo: string;
    usuario: string;
    comentario: string;
}): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function responderComentarioLectura(data: {
    comentarioId: string;
    usuario: string;
    respuesta: string;
}): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function toggleLikeComentario(comentarioId: string, usuario: string): Promise<{
    ok: boolean;
    mensaje: string;
    miLike?: never;
    likes?: never;
} | {
    ok: boolean;
    miLike: boolean;
    likes: number;
    mensaje?: never;
}>;
export declare function editarComentarioLectura(comentarioId: string, comentario: string): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function eliminarComentarioLectura(comentarioId: string): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function editarRespuestaLectura(respuestaId: string, respuesta: string): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function eliminarRespuestaLectura(respuestaId: string): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function getConversacionesLibro(libro: string): Promise<{
    libro: string;
    tipo: string;
    estado: string;
    comentarios: number;
    likes: number;
    ultimaActividad: string;
}[]>;
//# sourceMappingURL=readings.service.d.ts.map