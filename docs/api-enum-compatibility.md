# Compatibilidad temporal de enums Flutter/API

La API valida el vocabulario español que envía la APK y lo normaliza una sola vez,
en la frontera Zod, antes de invocar servicios o Prisma. Las respuestas mantienen el
vocabulario español (`PENDIENTE`, `AUDIOLIBRO`, etc.).

Durante la transición también se aceptan los nombres internos ingleses de Prisma.
Esta compatibilidad se retirará en una versión mayor del contrato, después de medir
que ya no existen clientes antiguos. También se conservan por compatibilidad los
alias históricos `RELECTURA`, `FÍSICO`, `PAPER`, `EBOOK` y `AUDIO`.

Los valores vigentes observados en Flutter son:

- Estado: `PENDIENTE`, `LEYENDO`, `PAUSADO`, `FINALIZADO`, `ABANDONADO`, `RELECTURA`.
- Formato: `FISICO`, `DIGITAL`, `AUDIOLIBRO`.
- Prioridad: `BAJA`, `MEDIA`, `ALTA`.
- Reacción: `LIKE`, `AGREE`, `ANGRY`, `FUNNY`, `THUMBS_UP`, `CRY`, `WOW`, `SWEAR`, `CLAP`.
- Tipo de lectura: `LIBRE`, `OFICIAL`.

`RELEYENDO` se acepta como sinónimo público adicional de `RELECTURA`. Ambos se
normalizan a `REREADING`.
