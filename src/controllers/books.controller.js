import { getLibros, getLibrosFinalizados, anadirLibroExistente, iniciarLectura, actualizarEstado, actualizarValoracion, crearLibro, } from '../services/books.service.js';
export async function handleLibros(req, res) {
    const data = await getLibros(String(req.query.usuario || ''));
    return res.json(data);
}
export async function handleLibrosFinalizados(_req, res) {
    const data = await getLibrosFinalizados();
    return res.json(data);
}
export async function handleCrearLibro(req, res) {
    const data = await crearLibro(req.body ?? {});
    return res.json(data);
}
export async function handleAnadirLibroExistente(req, res) {
    const data = await anadirLibroExistente(String(req.query.usuario || ''), String(req.query.libro || ''));
    return res.json(data);
}
export async function handleIniciarLectura(req, res) {
    const data = await iniciarLectura(String(req.query.usuario || ''), String(req.query.libro || ''));
    return res.json(data);
}
export async function handleActualizarValoracion(req, res) {
    const data = await actualizarValoracion(String(req.query.usuario || ''), String(req.query.libro || ''), String(req.query.valoracion || ''));
    return res.json(data);
}
export async function handleActualizarEstado(req, res) {
    const body = req.body ?? {};
    const data = await actualizarEstado(String(body.usuario || req.query.usuario || ''), String(body.libro || req.query.libro || ''), String(body.estado || req.query.estado || ''), String(body.valoracion || req.query.valoracion || ''), String(body.reflexion || req.query.reflexion || ''));
    return res.json(data);
}
//# sourceMappingURL=books.controller.js.map