# Autenticación de la APK

Todas las acciones se envían a `/api?action=...`. Las acciones de
autenticación solo aceptan `POST` con cuerpo JSON.

## Activación inicial

1. `solicitarActivacion`

   ```json
   { "email": "usuaria@example.com" }
   ```

2. `activarCuenta`

   ```json
   {
     "email": "usuaria@example.com",
     "codigo": "123456",
     "password": "una contraseña de 10 o más caracteres"
   }
   ```

La segunda acción devuelve `accessToken`, `refreshToken` y los datos de la
usuaria. Las cuentas, bibliotecas e historiales existentes no se recrean.

## Registro de una cuenta nueva

1. `solicitarRegistro`

   ```json
   { "nombre": "Nueva lectora", "email": "usuaria@example.com" }
   ```

2. `completarRegistro`

   ```json
   {
     "email": "usuaria@example.com",
     "codigo": "123456",
     "password": "una contraseña de 10 o más caracteres"
   }
   ```

La cuenta se crea sin pertenecer a ningún club. Después puede usar las acciones
autenticadas `crearClub` o `unirseClub`.

## Clubes

- `misClubes` (`GET`) devuelve las membresías y el club activo.
- `crearClub` (`POST`): `{ "nombre": "...", "descripcion": "..." }`.
- `unirseClub` (`POST`): `{ "codigo": "..." }`.
- `seleccionarClub` (`POST`): `{ "clubId": "..." }`.
- `invitacionClub` (`POST`): `{ "clubId": "..." }`, solo para propietarias y
  administradoras.

## Entrada habitual

`login`

```json
{
  "email": "usuaria@example.com",
  "password": "contraseña"
}
```

La APK debe enviar el token corto en las llamadas posteriores:

```text
Authorization: Bearer ACCESS_TOKEN
```

Con token ya no es necesario enviar `usuario`. Si se envía por compatibilidad,
debe coincidir con la sesión.

## Renovación

`refreshToken`

```json
{ "refreshToken": "TOKEN_DE_RENOVACION" }
```

El refresh token rota: la APK debe sustituir tanto el access token como el
refresh token por los valores de la respuesta.

## Contraseña olvidada

1. `solicitarResetPassword`

   ```json
   { "email": "usuaria@example.com" }
   ```

2. `resetPassword`

   ```json
   {
     "email": "usuaria@example.com",
     "codigo": "123456",
     "password": "contraseña nueva"
   }
   ```

## Cambio y cierre de sesión

`cambiarPassword` requiere `Authorization`:

```json
{
  "passwordActual": "contraseña actual",
  "passwordNueva": "contraseña nueva"
}
```

`logout` requiere `Authorization` y no necesita cuerpo.

## Tiempos y límites

- Access token: 15 minutos.
- Refresh token: 30 días.
- Código: 10 minutos y 5 intentos.
- Reenvío: como máximo una vez por minuto y cinco veces por hora.
- Login: bloqueo de 15 minutos después de cinco fallos consecutivos.

## Access tokens

Los access tokens se firman con `jose` usando exclusivamente `HS256` y un
secreto simétrico de al menos 32 caracteres. Incluyen `sub`, `sid`,
`type: "access"`, `iat`, `exp`, `iss` y `aud`; caducan a los 15 minutos. El
backend limita el token recibido a 4096 bytes antes de verificarlo y, tras la
verificación criptográfica, comprueba que la sesión siga activa en PostgreSQL.

| Variable | Valor predeterminado |
| --- | --- |
| `AUTH_ACCESS_TOKEN_ISSUER` | `clubreads-api` |
| `AUTH_ACCESS_TOKEN_AUDIENCE` | `clubreads-app` |

Ambos valores deben ser iguales en todas las réplicas. Cambiarlos invalida los
access tokens ya emitidos, por lo que debe hacerse como una rotación coordinada.
Esta incorporación de `iss`/`aud` no cambia el formato ni el hash de los refresh
tokens. Los access tokens emitidos antes del despliegue, que no contienen esos
claims, dejarán de validarse; su vida máxima ya era de 15 minutos. La sesión
PostgreSQL no se revoca: el cliente puede usar su refresh token existente para
obtener inmediatamente un access token nuevo, sin iniciar sesión de nuevo.

## Transición desde la APK antigua

Todas las rutas, salvo las acciones públicas de registro, activación, login,
recuperación y renovación de sesión, exigen un access token válido. La identidad
se obtiene siempre de la sesión; cualquier valor `usuario` enviado por clientes
antiguos se ignora y no sirve para autenticarse.

## Configuración gratuita de Brevo

1. Crear una cuenta gratuita en Brevo.
2. Añadir una dirección Gmail como remitente.
3. Verificarla con el código que Brevo envía a esa dirección.
4. Activar Transactional Email en Brevo.
5. Crear una API key.
6. Configurar `BREVO_API_KEY`, `AUTH_EMAIL_FROM` y
   `AUTH_EMAIL_FROM_NAME`.

El plan gratuito permite actualmente hasta 300 envíos diarios. No es necesario
comprar ni configurar un dominio para comenzar; Brevo puede reemplazar
técnicamente una dirección gratuita por un remitente suyo para asegurar la
entrega.

Nunca se deben guardar las claves ni los secretos de autenticación en Git.

# Rate limiting de red

Todas las rutas bajo `/api` tienen un límite general por IP. Las acciones
públicas de autenticación añaden límites más estrictos según su riesgo:

- `login` y `refreshToken`: intentos de credenciales.
- Solicitudes de activación, registro y recuperación: envío de correo.
- Activación, finalización del registro y cambio de contraseña: confirmación de
  códigos.

Cuando se supera un límite, la API responde con HTTP `429`,
`error: "RATE_LIMITED"` y un mensaje genérico. No se registran cuerpos de
autenticación, contraseñas, códigos, tokens ni direcciones de correo.

| Variable | Valor predeterminado |
| --- | ---: |
| `RATE_LIMIT_API_WINDOW_MS` | `60000` |
| `RATE_LIMIT_API_MAX` | `120` |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `600000` |
| `RATE_LIMIT_AUTH_MAX` | `10` |
| `RATE_LIMIT_EMAIL_WINDOW_MS` | `3600000` |
| `RATE_LIMIT_EMAIL_MAX` | `3` |
| `RATE_LIMIT_CODE_WINDOW_MS` | `900000` |
| `RATE_LIMIT_CODE_MAX` | `8` |
| `TRUST_PROXY_HOPS` | `1` en producción, `0` fuera de producción |

Railway termina TLS y actúa como proxy inmediato. En producción se confía por
defecto en un único salto, no en una cadena arbitraria de `X-Forwarded-For`.
`TRUST_PROXY_HOPS` solo debe cambiarse si la topología incorpora otro proxy
controlado, verificando entonces el número exacto de saltos.

El store en memoria protege una única instancia y se reinicia con el proceso.
Antes de desplegar varias réplicas debe sustituirse por un store compartido,
preferiblemente Redis, o por el rate limiting del proveedor.

# CORS y cabeceras HTTP

Helmet añade las cabeceras de seguridad HTTP a todas las respuestas. La API
admite únicamente los métodos `GET`, `POST` y `OPTIONS`, y las cabeceras CORS
`Authorization`, `Content-Type` y `Accept`. No se habilitan credenciales CORS:
la autenticación utiliza tokens Bearer y no cookies.

Las aplicaciones móviles nativas pueden llamar a la API sin cabecera `Origin`.
Cuando una petición sí incluye `Origin`, debe coincidir exactamente con uno de
los valores separados por comas de `CORS_ALLOWED_ORIGINS`:

```text
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

En producción no se añade ningún origen implícito; si la variable está vacía,
solo se aceptan peticiones sin `Origin`. Fuera de producción se añaden
explícitamente `localhost` y `127.0.0.1` en los puertos `3000` y `5173`, además
de los valores configurados. Esta excepción local no se activa cuando
`NODE_ENV=production`.

La configuración de Railway conserva un único `trust proxy`: un salto en
producción y ninguno en desarrollo, salvo ajuste explícito mediante
`TRUST_PROXY_HOPS`.
