import { getUsuarios } from '../services/users.service.js';
export async function handleUsuarios(_req, res) {
    const data = await getUsuarios();
    return res.json(data);
}
//# sourceMappingURL=users.controller.js.map