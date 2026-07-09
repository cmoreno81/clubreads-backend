import type { Request, Response } from 'express';
export declare function handleLibros(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleLibrosFinalizados(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleCrearLibro(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleAnadirLibroExistente(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleIniciarLectura(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleActualizarValoracion(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleActualizarEstado(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=books.controller.d.ts.map