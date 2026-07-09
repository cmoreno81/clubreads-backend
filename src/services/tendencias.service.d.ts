export declare function getTendenciasClub(): Promise<{
    titular: string;
    narrador: string;
    generos: {
        nombre: string;
        total: number;
    }[];
    libros: {
        nombre: string;
        total: number;
    }[];
    lectoras: {
        nombre: string;
        total: number;
    }[];
    totalLeyendo: number;
}>;
//# sourceMappingURL=tendencias.service.d.ts.map