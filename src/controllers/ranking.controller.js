import { getRanking } from '../services/ranking.service.js';
export async function handleRanking(_req, res) {
    const data = await getRanking();
    return res.json(data);
}
//# sourceMappingURL=ranking.controller.js.map