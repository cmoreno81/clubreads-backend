# Optimización del dashboard de club

## Instrumentación temporal

Cada bloque de `getDashboard` emite `event=dashboard_block`, `block`,
`durationMs`, `rows` y, en caso de fallo, `outcome=error`. No se registran
usuarias, libros, clubes, filtros, IDs ni respuestas. Los bloques son:

- `context`;
- `monthly_completions` y `monthly_readers`;
- `review_average`;
- `currently_reading`;
- `clubvision_snapshot`;
- `affinity`;
- `official_finished`, `official_reviews` y `official_reading`;
- `official_comment_count`, `official_like_count` y
  `official_latest_activity`.

Esta instrumentación es temporal: tras reunir tráfico representativo en
Railway debe reducirse a nivel debug o retirarse, conservando el evento global
`http_request`.

## Antes y después

| Bloque | Antes | Después |
| --- | --- | --- |
| Mes actual | Todas las `ReadingCompletion` históricas del club con `user` y `book` completos; filtrado en Node | `groupBy(userId)` dentro del intervalo mensual de Madrid y una selección mínima de las usuarias agrupadas |
| Valoración media | Todas las `Review` positivas | `_avg(rating)` en PostgreSQL |
| Leyendo ahora | `user`, `book`, `genre` y reacciones mediante includes completos | `select` de los campos consumidos |
| Libro ganador | Búsqueda adicional por título | Reutiliza `ganadorBookId` y `ganadorCoverUrl` del snapshot |
| Finalizadas oficiales | Biblioteca, usuaria, libro y todas sus reviews | Usuaria mínima y una consulta de reviews mínima por libro |
| Actividad oficial | Árbol completo de conversaciones, comentarios, respuestas, usuarios y likes | Lectura oficial mínima, dos `count` y una consulta `findFirst` para última actividad |
| Clubvisión | `getClubvision` sincronizaba calendario y podía escribir | `getClubvisionSnapshot` es de solo lectura y reutiliza el contexto del dashboard |

`topLectorasMes` se calcula con los grupos mensuales. Conserva `usuario`,
`avatarUrl` y `total`, y añade `nombre` de forma compatible. Ordena por total
descendente y por nombre como desempate estable.

## Medición disponible

No existe una base local/de pruebas confirmada. La base configurada es remota y
no desechable; por ello no se ejecutó el dashboard real ni una prueba de carga
contra PostgreSQL. Los logs anteriores solo indicaban timeouts del endpoint y
no incluían duración por bloque, de modo que no hay una cifra anterior precisa
que pueda atribuirse honestamente.

El test local con colaboradores simulados valida la instrumentación y la forma
de las consultas. Una ejecución representativa modela 10.007 finalizaciones
mensuales: el servicio recibe cuatro grupos/filas, no 10.007 registros. En la
ejecución local, los bloques simulados individuales quedaron aproximadamente
entre 0,00 y 0,22 ms; estos tiempos miden coordinación en memoria y no latencia
PostgreSQL. La comparación real antes/después deberá obtenerse en Railway
filtrando `event=dashboard_block`, agrupando por `block`, una vez desplegada la
corrección en un entorno de prueba o staging.

No se aumentó ningún timeout.
