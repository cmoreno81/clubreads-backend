import { getMoodClub } from '../services/mood.service.js';
export async function handleMoodClub(_req, res) {
    const data = await getMoodClub();
    return res.json(data);
}
//# sourceMappingURL=mood.controller.js.map