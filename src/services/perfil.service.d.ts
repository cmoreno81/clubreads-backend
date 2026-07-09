export declare function getPerfilUsuario(usuario: string): Promise<{
    ok: boolean;
    mensaje: string;
    usuario?: never;
    email?: never;
    resumen?: never;
    leyendo?: never;
    terminados?: never;
    abandonados?: never;
    pendientes?: never;
    generosFavoritos?: never;
} | {
    ok: boolean;
    usuario: string;
    email: string;
    resumen: {
        terminados: number;
        leyendo: number;
        pendientes: number;
        abandonados: number;
        media: number;
        comentarios: number;
        likesRecibidos: number;
    };
    leyendo: {
        libro: string;
        genero: string;
    }[];
    terminados: {
        libro: string;
        genero: string;
        fecha: string;
        valoracion: string;
        resena: string;
    }[];
    abandonados: {
        libro: string;
        genero: string;
        fecha: string;
        valoracion: string;
    }[];
    pendientes: {
        libro: string;
        genero: string;
    }[];
    generosFavoritos: {
        genero: string;
        total: number;
    }[];
    mensaje?: never;
}>;
//# sourceMappingURL=perfil.service.d.ts.map