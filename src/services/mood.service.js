import { prisma } from '../prisma.js';
function tiempoRelativo(fecha) {
    const diffMin = Math.floor((Date.now() - fecha.getTime()) / 60000);
    if (diffMin < 1)
        return 'ahora';
    if (diffMin < 60)
        return `hace ${diffMin} min`;
    const horas = Math.floor(diffMin / 60);
    if (horas < 24)
        return `hace ${horas} h`;
    if (horas < 48)
        return 'ayer';
    return fecha.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
    });
}
export async function getMoodClub() {
    const comentarios = await prisma.comment.findMany({
        where: {
            deletedAt: null,
        },
        include: {
            user: true,
            conversation: {
                include: {
                    reading: {
                        include: {
                            book: true,
                        },
                    },
                },
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
        take: 10,
    });
    const terminados = await prisma.library.findMany({
        where: {
            status: 'FINISHED',
            finishedAt: {
                not: null,
            },
        },
        include: {
            user: true,
            book: true,
        },
        orderBy: {
            finishedAt: 'desc',
        },
        take: 5,
    });
    const actividadEventos = [
        ...comentarios.map((c) => ({
            fecha: c.createdAt,
            icono: c.parentId ? '↩️' : '💬',
            texto: c.parentId
                ? `${c.user.name} respondió en ${c.conversation.reading.book.title} ${tiempoRelativo(c.createdAt)}`
                : `${c.user.name} comentó en ${c.conversation.reading.book.title} ${tiempoRelativo(c.createdAt)}`,
        })),
        ...terminados.slice(0, 3).map((l) => ({
            fecha: l.finishedAt,
            icono: '📚',
            texto: `${l.user.name} terminó ${l.book.title} ${tiempoRelativo(l.finishedAt)}`,
        })),
    ];
    const actividad = actividadEventos
        .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
        .slice(0, 10)
        .map(({ icono, texto }) => ({
        icono,
        texto,
    }));
    const comentariosSemana = await prisma.comment.count({
        where: {
            deletedAt: null,
            createdAt: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
        },
    });
    const lecturasActivas = await prisma.reading.count({
        where: {
            status: 'ACTIVE',
        },
    });
    const estados = [];
    if (comentariosSemana >= 10)
        estados.push('🔥 Debate caliente');
    if (comentariosSemana >= 5)
        estados.push('💬 Mucha conversación');
    if (lecturasActivas > 0)
        estados.push('📚 Club en marcha');
    if (estados.length === 0)
        estados.push('😌 Semana tranquila');
    let titular = 'Semana tranquila entre lecturas.';
    let narrador = 'El club está en modo lectura pausada. A veces las mejores conversaciones llegan después de unos cuantos capítulos.';
    const ultimoTerminado = terminados[0];
    if (comentariosSemana >= 10) {
        titular = 'El club está que arde entre teorías, respuestas y comentarios.';
        narrador =
            'Hay movimiento, hay debate y hay lectoras entrando al barro. Esta semana el club está especialmente vivo.';
    }
    else if (comentariosSemana >= 5) {
        titular = 'Las conversaciones empiezan a coger ritmo.';
        narrador =
            'Varias lectoras han pasado por los capítulos para dejar impresiones. Se nota que la lectura está avanzando.';
    }
    else if (ultimoTerminado) {
        titular = `${ultimoTerminado.user.name} acaba de cerrar una lectura.`;
        narrador =
            'El club sigue sumando libros terminados. Poco a poco, las estanterías personales van contando la historia del mes.';
    }
    return {
        titular,
        narrador,
        estados,
        actividad,
        resumen: {
            comentariosSemana,
            lecturasActivas,
        },
    };
}
//# sourceMappingURL=mood.service.js.map