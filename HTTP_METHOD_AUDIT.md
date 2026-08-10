# Auditoría de métodos HTTP

Las acciones mutadoras de `/api?action=...` solo aceptan `POST` y reciben sus
datos de escritura mediante JSON en el cuerpo. `action` permanece en la URL por
compatibilidad con Flutter. La identidad procede exclusivamente del token
Bearer validado y de `req.auth`.

## Lecturas con efectos secundarios pendientes de separar

Estas acciones continúan admitiendo `GET` para no cambiar su comportamiento en
esta tarea, pero pueden escribir durante una lectura y deben refactorizarse por
separado:

- `clubvision`: sincroniza la edición actual; puede crear candidatas y
  resultados, cambiar el estado de Clubvisión y emitir notificaciones.
- `dashboard`: llama a `getClubvision`, por lo que hereda esa sincronización.
- `comentariosLectura`: actualiza o crea `ConversationRead` para marcar el
  capítulo como visto.

`configuracionLectura`, pese a su nombre, actualmente solo consulta la
configuración y no modifica datos. Se mantiene como operación GET.
