export declare function getRanking(): Promise<{
    masDeseados: {
        libro: string;
        total: number;
    }[];
    masLeidos: {
        libro: string;
        total: number;
    }[];
    mejorValorados: {
        libro: string;
        media: number;
        votos: number;
    }[];
    masAbandonados: {
        libro: string;
        total: number;
    }[];
    topLectoras: {
        usuario: string;
        total: number;
    }[];
}>;
//# sourceMappingURL=ranking.service.d.ts.map