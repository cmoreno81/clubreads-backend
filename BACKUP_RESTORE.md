# Backup y restauración de PostgreSQL

## Estado comprobado

| Aspecto | Estado |
| --- | --- |
| Alojamiento | PostgreSQL de producción está en Railway; se verificó solo el proveedor, sin mostrar la URL. |
| Mecanismo | Railway ofrece backups manuales y schedules diario, semanal y mensual para volúmenes, además de PITR para PostgreSQL. |
| Retención y frecuencia reales | No verificables desde este entorno; confirmar en `PostgreSQL > Backups`. |
| Última copia restaurable | No verificada. |
| Responsable | Pendiente de asignar por la propietaria del workspace: responsable primario y sustituto. |
| Acceso | Restringir backups, variables y restores a propietarias/administradoras que lo necesiten; revisión trimestral. |

Cuando se activan, Railway conserva los backups diarios 6 días, los semanales
1 mes y los mensuales 3 meses; pueden combinarse. Esto describe la capacidad
del proveedor, no la configuración actual de ClubReads. PITR, si está activo,
archiva WAL, realiza un full semanal e incrementales diarios y mantiene
aproximadamente cuatro semanas. Hay que registrar el rango real del panel.

Una persona con acceso a Railway debe registrar, sin copiar credenciales:

1. Entorno, servicio PostgreSQL y volumen.
2. Fecha y estado del último backup.
3. Schedules activos y estado/rango de PITR.
4. Responsable, sustituto y próxima prueba.

## Herramientas y seguridad

Se requieren `pg_dump`, `pg_restore`, cliente PostgreSQL compatible y `age`.
La identidad privada de `age` debe quedar fuera de Git, Railway y la carpeta de
backups. Los scripts nunca pasan la URL como argumento: derivan variables `PG*`
solo para el proceso hijo y silencian su salida. Los backups se escriben fuera
del repositorio con carpeta `0700`, archivo `0600` y nombre técnico sin datos
personales.

## Backup custom cifrado y verificación

Configurar los valores mediante un gestor seguro de terminal, sin imprimirlos:

```bash
BACKUP_DIR=/ruta/privada/fuera-del-repositorio \
BACKUP_AGE_RECIPIENT=age1... \
BACKUP_CONFIRM_READ_ONLY=YES \
npm run db:backup
```

Ejecuta `pg_dump --format=custom --no-owner --no-acl`, valida el temporal con
`pg_restore --list`, cifra con `age` y elimina únicamente el plaintext temporal.
No automatiza la retención ni el borrado de backups. La salida `.dump.age` está
ignorada por Git y Docker.

Verificación independiente:

```bash
BACKUP_AGE_IDENTITY_FILE=/ruta/privada/identity.txt \
npm run db:backup:verify -- /ruta/privada/clubreads-FECHA.dump.age
```

## Restauración exclusivamente local

Crear manualmente una base vacía cuyo nombre incluya `test`, `restore`, `temp`,
`tmp`, `scratch` o `disposable`. El script rechaza hosts distintos de
`localhost`, `127.0.0.1` o `::1` y aborta si existe una sola tabla. No crea,
vacía ni elimina bases.

```bash
RESTORE_DATABASE_URL='configurada de forma privada' \
BACKUP_AGE_IDENTITY_FILE=/ruta/privada/identity.txt \
RESTORE_CONFIRM_EMPTY_TEST_DATABASE=YES \
npm run db:restore:test -- /ruta/privada/clubreads-FECHA.dump.age
```

Usa `pg_restore --exit-on-error --single-transaction`. Devuelve únicamente
duración y conteos agregados de usuarios, clubes, libros, bibliotecas, lecturas,
comentarios y sesiones. Comprueba FKs no validadas, relaciones huérfanas
principales y migraciones aplicadas/fallidas.

Después, apuntando **solo** a la misma base local restaurada:

```bash
npm run build
npm start
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/ready
npx prisma migrate status
```

`migrate status` es diagnóstico. No ejecutar `migrate deploy`, `migrate dev`,
`db push`, `migrate reset`, seeds ni imports.

## Objetivos propuestos

- RPO inicial: 24 horas con backup diario. Objetivo recomendado: 15 minutos
  después de activar y monitorizar PITR.
- RTO inicial: 2 horas hasta tener el backend validado. Ajustarlo tras dos
  pruebas con volumen representativo.
- Ensayo: mensual y tras cambios mayores de PostgreSQL.

## Emergencia

1. Declarar incidente, detener despliegues y escrituras no esenciales.
2. Preservar logs y registrar la hora objetivo sin datos personales.
3. Confirmar responsable, última copia y rango PITR.
4. Nunca restaurar encima de producción para probar: crear fork o destino temporal.
5. Restaurar y validar conteos, integridad, migraciones, `/health` y `/ready`.
6. Validar con cuentas de prueba y aprobar el punto de recuperación.
7. Planificar cambio de conexión, ventana de solo lectura y reversión.
8. Cambiar producción solo con autorización separada.
9. Medir RPO/RTO reales y evaluar obligaciones de seguridad y RGPD.

El restore nativo de volumen puede cambiar el volumen montado y redesplegar el
servicio. PITR crea un servicio hermano y permite validarlo antes del cambio.
Ninguna operación del panel Railway forma parte de esta prueba local.
