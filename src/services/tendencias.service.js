import { prisma } from '../prisma.js';
function top(items, limit = 5) {
    return items.slice(0, limit);
}
export async function getTendenciasClub() {
    const leyendoAhora = await prisma.library.findMany({
        where: {
            status: 'READING',
        },
        include: {
            user: true,
            book: {
                include: {
                    genre: true,
                },
            },
        },
        orderBy: {
            updatedAt: 'desc',
        },
    });
    const generos = new Map();
    const libros = new Map();
    const lectoras = new Map();
    for (const item of leyendoAhora) {
        const genero = item.book.genre?.name ?? 'Sin género';
        generos.set(genero, (generos.get(genero) ?? 0) + 1);
        libros.set(item.book.title, (libros.get(item.book.title) ?? 0) + 1);
        lectoras.set(item.user.name, (lectoras.get(item.user.name) ?? 0) + 1);
    }
    const generosTop = top(Array.from(generos.entries())
        .map(([nombre, total]) => ({ nombre, total }))
        .sort((a, b) => b.total - a.total));
    const librosTop = top(Array.from(libros.entries())
        .map(([nombre, total]) => ({ nombre, total }))
        .sort((a, b) => b.total - a.total));
    const lectorasTop = top(Array.from(lectoras.entries())
        .map(([nombre, total]) => ({ nombre, total }))
        .sort((a, b) => b.total - a.total));
    const generoPrincipal = generosTop[0];
    const titular = generoPrincipal
        ? `${generoPrincipal.nombre} domina las lecturas actuales del club.`
        : 'El club está repartido entre varias lecturas.';
    const narrador = generoPrincipal
        ? `Ahora mismo ${generoPrincipal.total} lectora${generoPrincipal.total === 1 ? '' : 's'} están leyendo ${generoPrincipal.nombre}. Parece que este género está marcando el ritmo del club.`
        : 'No hay una tendencia clara todavía. El club está explorando lecturas distintas.';
    return {
        titular,
        narrador,
        generos: generosTop,
        libros: librosTop,
        lectoras: lectorasTop,
        totalLeyendo: leyendoAhora.length,
    };
}
//# sourceMappingURL=tendencias.service.js.map