# Validación de entradas de la API

Las acciones mutadoras y de autenticación se validan con Zod antes de ejecutar el controlador. `action` continúa en la URL; los datos mutadores solo se validan y leen desde el cuerpo JSON. Los errores usan `VALIDATION_ERROR` y solo enumeran nombres de campos, nunca valores recibidos.

Los objetos aceptan campos adicionales mientras se confirma el inventario completo de versiones de la APK. Se validan de forma cerrada los elementos de listas con riesgo estructural (orden personal e importaciones), aunque se toleran propiedades adicionales conocidas por versiones futuras.

Compatibilidad temporal explícita:

- páginas, capítulos, progreso y valoraciones admiten número JSON o cadena decimal;
- prólogo y epílogo admiten booleanos JSON o `"1"`/`"0"`;
- comentarios admiten `comentario` y el alias histórico `texto`;
- identificadores editables admiten los alias `id` documentados por los controladores actuales.

Antes de aplicar `.strict()` a cuerpos completos debe capturarse un inventario anonimizado de nombres de campos por versión de cliente. No deben registrarse valores, cuerpos, emails, contraseñas, códigos ni tokens.
