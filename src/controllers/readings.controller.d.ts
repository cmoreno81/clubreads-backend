import type { Request, Response } from 'express';
export declare function handleLecturasActivas(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleCrearLectura(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleConfiguracionLectura(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleComentariosLectura(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleGuardarComentarioLectura(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleResponderComentario(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleToggleLikeComentario(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleEditarComentario(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleEliminarComentario(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleEditarRespuesta(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleEliminarRespuesta(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function handleConversacionesLibro(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=readings.controller.d.ts.map