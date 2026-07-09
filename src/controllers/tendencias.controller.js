import { getTendenciasClub } from '../services/tendencias.service.js';
export async function handleTendenciasClub(_req, res) {
    const data = await getTendenciasClub();
    return res.json(data);
}
//# sourceMappingURL=tendencias.controller.js.map