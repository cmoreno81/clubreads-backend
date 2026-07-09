import { getPerfilUsuario } from '../services/perfil.service.js';
export async function handlePerfilUsuario(req, res) {
    const data = await getPerfilUsuario(String(req.query.usuario || ''));
    return res.json(data);
}
//# sourceMappingURL=perfil.controller.js.map