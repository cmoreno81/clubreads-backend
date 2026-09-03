# Simulación desechable de Clubvisión

Este generador crea once clubes artificiales para recorrer los caminos de
Clubvisión sin modificar Railway ni datos reales. La protección exige la base
local `clubreads_disposable_test` en el puerto `55432`; cualquier host remoto se
rechaza antes de escribir.

## Preparación

```bash
npm run disposable:up
ALLOW_DISPOSABLE_DB_WRITES=true npm run disposable:clubvision:scenarios
```

El generador se puede repetir: elimina únicamente registros cuyo identificador
empieza por `CV_SCENARIO_` y los vuelve a crear. Al terminar escribe las cuentas,
clubes y fechas recomendadas en:

```text
/private/tmp/clubreads-clubvision-scenarios.json
```

Todas las cuentas usan la contraseña `ClubReadsTest2026!`.

## Arrancar el backend simulado

Para la bienvenida y sus bloqueos, usa una fecha posterior al día 3:

```bash
SIMULATED_DATE=2026-09-10T10:00:00+02:00 npm run disposable:backend
```

Las fases mensuales dependen del día del mes. El manifiesto indica la fecha que
corresponde a cada escenario: día 1 para votación, día 3 para resultados y día
4 para lectura. Reinicia el backend cambiando `SIMULATED_DATE` al pasar de una
fase mensual a otra.

## Arrancar Flutter sin apuntar a producción

En el simulador iOS:

```bash
flutter run --dart-define=CLUBREADS_API_BASE_URL=http://127.0.0.1:3000/api
```

En el emulador Android, sustituye la dirección por
`http://10.0.2.2:3000/api`. El valor por defecto de una compilación normal sigue
siendo Railway; solo la ejecución que incluye el `dart-define` usa la base
desechable.

## Caminos incluidos

- Bienvenida bloqueada por miembros, candidatos o antigüedad.
- Bienvenida preparada para que la propietaria la inicie desde la app.
- Bienvenida en votación parcial, resultados, lectura y cierre sin votos.
- Clubvisión mensual en votación, resultados y lectura.

