export declare function getDashboard(): Promise<{
    resumen: {
        usuarioMes: string;
        librosUsuarioMes: number;
        actividadMes: number;
        valoracionMedia: string;
    };
    leyendoAhora: {
        usuario: string;
        libros: string[];
        total: number;
    }[];
    tendencia: string;
    mood: string;
    libroMes: never[];
    clubvision: {
        abierta: boolean;
        estado: string;
        idVotacion: string;
        haVotado: boolean;
        candidatas: {
            libro: string;
            genero: string;
            interesadas: number;
            usuarias: string[];
        }[];
        votosRecibidos: number;
        totalUsuarios: number;
        votosPendientes: number;
        porcentaje: number;
        titulo: string;
        mensaje: string;
        ganador: string;
        lectoras: never[];
        totalCandidatas: number;
        comentarios: number;
        likes: number;
        ultimaActividad: string;
    };
    lecturaActual: {
        ok: boolean;
        titulo: string;
        comentarios: number;
        likes: number;
        ultimaActividad: string;
        totalLeyendo: number;
        totalFinalizado: number;
        leyendo: string[];
        finalizado: {
            usuario: string;
            valoracion: string;
        }[];
    };
}>;
//# sourceMappingURL=dashboard.service.d.ts.map