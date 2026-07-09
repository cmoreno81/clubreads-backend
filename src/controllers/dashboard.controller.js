import { getDashboard } from '../services/dashboard.service.js';
export async function handleDashboard(_req, res) {
    const data = await getDashboard();
    return res.json(data);
}
//# sourceMappingURL=dashboard.controller.js.map