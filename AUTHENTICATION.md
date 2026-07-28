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

## Transición desde la APK antigua

Mientras `AUTH_REQUIRE_ACCESS_TOKEN=false`, las rutas antiguas siguen aceptando
`usuario`. Cuando todas las usuarias hayan instalado la nueva APK, cambiar a
`AUTH_REQUIRE_ACCESS_TOKEN=true` para exigir sesión en el resto de la API.

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
