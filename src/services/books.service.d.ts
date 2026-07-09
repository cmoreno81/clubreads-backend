export declare function getLibros(usuario: string): Promise<{
    usuario: string;
    libro: string;
    genero: string;
    saga: string;
    numSaga: string;
    autoconclusivo: string;
    prioridad: string;
    leyendo: string;
    estado: string;
    valoracion: string;
    yaLoTengo: boolean;
    goodreads: string;
}[]>;
export declare function getLibrosFinalizados(): Promise<{
    usuario: string;
    libro: string;
    genero: string;
    saga: string;
    numSaga: string;
    autoconclusivo: string;
    valoracion: string;
    resena: string;
    review: string;
    goodreads: string;
    fecha: string | Date;
    mes: string;
}[]>;
export declare function anadirLibroExistente(usuario: string, libro: string): Promise<{
    ok: boolean;
    mensaje: string;
}>;
export declare function iniciarLectura(usuario: string, libro: string): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function actualizarEstado(usuario: string, libro: string, estado: string, valoracion?: string, reflexion?: string): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function actualizarValoracion(usuario: string, libro: string, valoracion: string): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function crearLibro(data: any): Promise<{
    ok: boolean;
    mensaje: string;
}>;
//# sourceMappingURL=books.service.d.ts.map