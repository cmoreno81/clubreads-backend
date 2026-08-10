# PostgreSQL desechable para ClubReads

Este entorno es independiente de `docker-compose.yml`: usa el servicio
`postgres_disposable`, la base fija `clubreads_disposable_test`, un usuario de
prueba y el volumen exclusivo `clubreads_disposable_test_pgdata_v18`. El puerto se
publica solamente en `127.0.0.1:55432`.

## Preparación

Requisitos: Docker Compose, Node, dependencias npm instaladas y `pg_restore`
18. El backup custom debe estar fuera del repositorio.

```bash
npm run disposable:init
```

El comando crea `.env.disposable` con permisos `0600`, usuario exclusivo y una
contraseña aleatoria que no imprime. Falla si el archivo ya existe. Como opción
manual, copia `.env.disposable.example` y genera una contraseña local. No
reutilices ninguna credencial. Mantén
`ALLOW_DISPOSABLE_DB_WRITES=false` hasta autorizar una operación de escritura.

## Operación

Levantar la base y comprobar su health:

```bash
npm run disposable:up
npm run disposable:health
```

Antes de restaurar, cambia temporalmente
`ALLOW_DISPOSABLE_DB_WRITES=true`. Primero ejecuta health: muestra únicamente
host, puerto, base e indicador local/remoto. Revisa esos cuatro valores y pide
autorización humana explícita. Solo tras obtenerla ejecuta:

```bash
CONFIRM_DISPOSABLE_RESTORE=RESTORE_TO_VERIFIED_DISPOSABLE_DB \
  npm run disposable:restore -- /ruta/fuera/del/repositorio/backup.dump
```

El restore valida el formato custom con `pg_restore --list`, exige cero tablas,
no usa `--clean`, restaura en una transacción y vuelve a verificar conteos,
claves foráneas, relaciones huérfanas y migraciones aplicadas/incompletas.

Comprobaciones posteriores (status no aplica migraciones):

```bash
npm run disposable:verify
npm run disposable:migrate:status
```

Arrancar el backend aislado:

```bash
npm run disposable:backend
```

El comando exige email desactivado o en captura local, Cloudinary desactivado, backfill de
portadas desactivado, cron desactivado y notificaciones externas desactivadas.
Los códigos se guardan con permisos `0600` bajo `AUTH_CODE_CAPTURE_DIR`; no se
imprimen ni se envían. Usa exclusivamente cuentas de prueba. Bórralos al acabar.
Las notificaciones internas de la aplicación pueden seguir escribiéndose en la
copia; no existe un transporte externo habilitado.

Seeds, imports y tests que escriben deben pasar por los wrappers protegidos:

```bash
npm run disposable:seed
npm run disposable:import:sheets -- --argumentos
npm run disposable:test:write
```

Todos exigen nombre/host/puerto exactos y
`ALLOW_DISPOSABLE_DB_WRITES=true`; una URL ausente, ambigua o inválida falla de
forma cerrada. No uses directamente comandos mutadores de Prisma. Para revisar
migraciones se usa solamente `disposable:migrate:status`.

Detener contenedores conservando el volumen o retirar contenedores/red:

```bash
npm run disposable:stop
npm run disposable:down
```

Eliminar el volumen destruye la copia. Revisa de nuevo el destino mostrado y
solicita una **segunda autorización humana explícita**, distinta de la del
restore. Solo entonces:

```bash
CONFIRM_DISPOSABLE_VOLUME_DELETE=DELETE_CLUBREADS_DISPOSABLE_VOLUME \
  npm run disposable:destroy
```

## Flutter

Arranca el backend en el puerto 3000 y configura la URL base según el cliente:

- iOS Simulator o Flutter desktop: `http://127.0.0.1:3000/api`.
- Android Emulator: `http://10.0.2.2:3000/api`.
- Dispositivo físico: usa la IP LAN del Mac (por ejemplo
  `http://192.168.x.y:3000/api`) y permite el puerto 3000 en el firewall. Esto
  expone el backend a la LAN, pero PostgreSQL continúa ligado a `127.0.0.1`.

En Android/iOS de desarrollo puede ser necesario permitir HTTP sin TLS en la
configuración específica de debug. No lleves esa excepción a producción.
