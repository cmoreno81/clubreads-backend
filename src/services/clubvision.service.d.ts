export declare function getClubvision(usuario: string): Promise<{
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
}>;
export declare function enviarVotacion(usuario: string, votos: string[]): Promise<{
    ok: boolean;
    mensaje: string;
} | {
    ok: boolean;
    mensaje?: never;
}>;
export declare function getMiVoto(usuario: string): Promise<{
    encontrado: boolean;
    usuario?: never;
    votos?: never;
    votosRecibidos?: never;
    totalUsuarios?: never;
    votosPendientes?: never;
    porcentaje?: never;
} | {
    encontrado: boolean;
    usuario: string;
    votos: string[];
    votosRecibidos: number;
    totalUsuarios: number;
    votosPendientes: number;
    porcentaje: number;
}>;
export declare function getComoVotaron(): Promise<{
    usuaria: string;
    votos: {
        puntos: number;
        libro: string;
    }[];
}[]>;
export declare function getHistorialClubvision(): Promise<{
    mes: string;
    ganadora: string;
    puntos: number;
    segunda: string;
    tercera: string;
}[]>;
//# sourceMappingURL=clubvision.service.d.ts.map