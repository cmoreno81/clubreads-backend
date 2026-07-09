import { prisma } from '../prisma.js';
export async function getUsuarios() {
    const users = await prisma.user.findMany({
        orderBy: {
            name: 'asc',
        },
    });
    return users.map((user) => ({
        nombre: user.name,
        email: user.email,
    }));
}
//# sourceMappingURL=users.service.js.map