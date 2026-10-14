# Guía de operaciones de ClubReads

Comandos que se usan para cuidar los datos y el servidor, con lo que hace cada uno. Se ejecutan desde una terminal. Última actualización: 14-oct-2026.

## 0 · Antes de nada: apuntar a producción

Tu .env tiene DOS líneas DATABASE_URL (la local y la de Railway). Por eso, para tocar producción se pasa siempre la de Railway a mano. Estas dos líneas la guardan en una variable sin enseñarla; ejecútalas una vez por pestaña de terminal.

**Preparar la terminal (una vez por pestaña)**

```bash
cd /Users/cristinamoreno/Developer/clublectura_api/ClubLecturaBackend
PROD=$(grep -E '^DATABASE_URL=.*railway' .env | tail -1 | cut -d= -f2- | tr -d '"')
```

- Lo que sigue usa «$PROD». Si abres una pestaña nueva, vuelve a ejecutar estas dos líneas.
- Los scripts nuevos solo MIRAN por defecto. Solo escriben con --ejecutar (los antiguos usan --apply). Mira siempre primero sin eso.

## 1 · Retirar un comentario o reseña denunciado

El ticket de Jira trae «Tipo: … · ID: …» en la descripción (los tickets desde el 14-oct). Tipos: comentario (de capítulo), comentarioProgreso, resena. El borrado es suave: deja de verse para todo el mundo pero queda guardado.

**Ver qué es, quién lo escribió y dónde (no cambia nada)**

```bash
DATABASE_URL="$PROD" npx tsx scripts/moderar-contenido.ts --tipo comentarioProgreso --id PEGA_AQUÍ_EL_ID
```

**Retirarlo**

```bash
DATABASE_URL="$PROD" npx tsx scripts/moderar-contenido.ts --tipo comentarioProgreso --id PEGA_AQUÍ_EL_ID --ejecutar
```

- Apple pide poder actuar sobre lo denunciado en unas 24 h.
- Bloquear a una persona lo hace cada usuaria desde la app. No existe suspender cuentas.

## 2 · Libros duplicados

Primero se busca, luego se fusiona. Fusionar mueve bibliotecas, reseñas, lecturas y conversaciones al libro que se conserva (el que tiene más gente), marca el otro como eliminado, deja una redirección y guarda una copia de lo que mueve en BookMergeAudit. Todo en una sola transacción: o se hace entero o no se hace.

**Auditar todo el catálogo (solo lee)**

```bash
DATABASE_URL="$PROD" npx tsx scripts/auditar-duplicados-catalogo.ts
```

**Buscar fichas por título (te da los IDs, bibliotecas y reseñas de cada una)**

```bash
DATABASE_URL="$PROD" npx tsx scripts/merge-books.ts --find "texto del título"
```

**Fusionar: el 1.º ID desaparece, el 2.º se conserva**

```bash
DATABASE_URL="$PROD" npx tsx scripts/merge-books.ts ID_ORIGEN ID_CANONICO "motivo"
```

- En la auditoría, la lista A (mismo ISBN) y la B (misma autoría y título equivalente) suelen ser duplicados de verdad. La C se llena de falsos avisos: tomos de una serie («Serie: Vol. 1», «Vol. 2»…). Revísala a mano.
- Tras fusionar, si una persona tenía el libro en las dos fichas, puede quedarle DOS «terminados» con fechas distintas (pasó con Sarah en «El Imperio Final»). Mira su historial y quita el que sobre.
- Deshacer una fusión: la ficha origen no se borra de verdad. Hay un ejemplo de cómo se deshizo una en scripts/unmerge-anathema.ts (copiar y adaptar con ayuda).
- El servidor ya une solo al añadir desde el buscador del catálogo si coincide autoría y título (incluido «Serie N - Título»). Si el catálogo externo no trae autoría, no se arriesga y puede crear una ficha nueva.

## 3 · Talento emergente (fichas de autoría)

Revisión de las fichas que llegan por el formulario de la web. Aprobar crea el libro (o marca el que ya existe) con su sello.

**Ver las fichas pendientes**

```bash
DATABASE_URL="$PROD" npm run talento:listar
```

**Ver todas (también las ya revisadas)**

```bash
DATABASE_URL="$PROD" npm run talento:listar -- todas
```

**Aprobar una ficha**

```bash
DATABASE_URL="$PROD" npm run talento:aprobar -- ID_FICHA
```

**Rechazar una ficha (con motivo)**

```bash
DATABASE_URL="$PROD" npm run talento:rechazar -- ID_FICHA "motivo"
```

**Retirar el sello a un libro**

```bash
DATABASE_URL="$PROD" npm run talento:retirar -- ID_LIBRO
```

**Destacar un libro como «Talento de la semana» (esta semana)**

```bash
DATABASE_URL="$PROD" npm run talento:destacar -- ID_LIBRO
```

- Si no destacas ninguno, rota solo cada semana.

## 4 · Probar y subir cambios

Servidor y app van por separado. El servidor se sube a main y Railway lo despliega solo (aplica las migraciones al arrancar; espera 2-3 minutos). La app se queda en develop hasta compilar la versión.

**Tests del servidor (usan una base de datos falsa: no tocan nada real)**

```bash
cd /Users/cristinamoreno/Developer/clublectura_api/ClubLecturaBackend
npm test
```

**Comprobar los tipos del servidor**

```bash
cd /Users/cristinamoreno/Developer/clublectura_api/ClubLecturaBackend
npx tsc --noEmit
```

**Tests de la app**

```bash
cd /Users/cristinamoreno/Developer/clubdelectura
flutter test
```

**Subir el servidor (despliega Railway)**

```bash
cd /Users/cristinamoreno/Developer/clublectura_api/ClubLecturaBackend
git status
git push origin main
```

- Fallan 16 tests antiguos del servidor y 19 de la app. Son comprobaciones obsoletas de antes: lo normal es que sigan siendo esos mismos. Si sale un número mayor, es nuevo.
- Un cambio de textos de avisos o de lógica del servidor llega a TODAS las apps al desplegar. Un cambio de la app solo llega con una versión nueva.

**Prueba completa de «Amigos» (sobre una base de pruebas LOCAL, nunca producción)**

```bash
cd /Users/cristinamoreno/Developer/clublectura_api/ClubLecturaBackend
DATABASE_URL="postgresql://postgres@localhost:PUERTO/NOMBRE" npx tsx scripts/probar-amigos-e2e.ts
```

Comprueba de punta a punta solicitudes, privacidad, reseñas con spoilers, reacciones y comentarios, recomendar, lista de deseos y reservas, lecturas a la vez (crear, aceptar, salir, eliminar, bloquear, tope) y avisos: 27 pasos. Se niega a correr si la base no es local. Pide ayuda para montar la base de pruebas la primera vez.

## 5 · Copias de seguridad

Hoy NO hay copia completa cifrada configurada (faltan la herramienta «age» y sus variables). Lo que sí tenemos:

**Copia lógica de Railway (necesita DATABASE_PUBLIC_URL)**

```bash
cd /Users/cristinamoreno/Developer/clublectura_api/ClubLecturaBackend
npm run db:backup:railway:logical
```

**Verificar una copia / probar a restaurarla**

```bash
npm run db:backup:verify
npm run db:restore:test
```

- Cada fusión guarda su copia en la tabla BookMergeAudit.
- Los cambios masivos que hicimos a mano guardan antes una copia de lo que tocan en ~/clubreads-backups/ (archivos solo legibles por ti). Ahí está la de la limpieza de géneros del 14-oct.
- Copia completa cifrada: npm run db:backup, pero exige instalar «age» y definir BACKUP_DIR, BACKUP_AGE_RECIPIENT y BACKUP_CONFIRM_READ_ONLY=YES. Pídemelo cuando quieras dejarla lista.

## 6 · Mantenimiento del catálogo

Rellenan portadas, idiomas y autorías que faltan. Previsualizar siempre antes de aplicar.

**Portadas: ver / aplicar**

```bash
DATABASE_URL="$PROD" npm run covers:preview
DATABASE_URL="$PROD" npm run covers:apply
```

**Idiomas: ver / aplicar**

```bash
DATABASE_URL="$PROD" npm run languages:preview
DATABASE_URL="$PROD" npm run languages:apply
```

**Autorías: ver / aplicar**

```bash
DATABASE_URL="$PROD" npm run authors:preview
DATABASE_URL="$PROD" npm run authors:apply
```

**Próximos lanzamientos**

```bash
DATABASE_URL="$PROD" npm run sync:upcoming-releases
```

- Estos llaman a servicios externos (Google, Open Library…): pueden tardar.
- Subir imágenes a Cloudinary desde tu ordenador está bloqueado a propósito (CLOUDINARY_WRITES_ENABLED); solo escribe el servidor en producción.

## 7 · Ligas y Clubvision

Corren solos; solo se lanzan a mano si hay que repetirlos o algo falló. Necesitan compilar antes.

**Recalcular el ranking / cerrar temporada / abrir Clubvision**

```bash
cd /Users/cristinamoreno/Developer/clublectura_api/ClubLecturaBackend
npm run build
DATABASE_URL="$PROD" npm run ligas:recompute
DATABASE_URL="$PROD" npm run ligas:close-season
DATABASE_URL="$PROD" npm run clubvision:open
```

- La temporada 2 de Ligas cierra el 22-oct. Si luego se ve un salto raro de división, mirar cerrarTemporada en src/services/ligas.service.ts.
- Usa estos comandos solo si sabes por qué: cerrar temporada o abrir una votación no se deshace con un botón.

## 8 · Lo que viene (fechas)

- Hasta el 22-oct: no compilar la 3.7.5 (espera a que Google apruebe la 2077).
- Desde el 22-oct: publicar clubreads-web-actualizada.zip (Escritorio) en Netlify y probar el formulario real de Talento; el dominio de Netlify debe estar en la variable CORS_ALLOWED_ORIGINS de Railway.
- Tras aprobar la 2077: activar Amazon (variable AMAZON_ASSOCIATE_TAG=clubreads-21 en Railway) y probar un enlace.
- Compilar la 3.7.5 (iOS y Android a la vez): flutter pub get → subir pubspec a 3.7.5+2078 → git status limpio → notas para Apple en ~/Desktop/ficha-apple-3.7.5/notas-para-la-revision.txt (menciona amigos, y Reportar y Bloquear por la regla 1.2).
- Plan de pruebas de la 3.7.5 (casillas): https://claude.ai/artifact/7S9NPYLTHF9JcAgYEHKKH3
- Lista de limpieza de géneros del 14-oct (ya aplicada): https://claude.ai/artifact/7n26kwk8oYZkePSeS94BKW

## 9 · Trampas conocidas

- Dos DATABASE_URL en el .env: usa siempre DATABASE_URL="$PROD" delante para producción. Si no pones nada, el script usa la que cargue el .env y puede no ser la que crees.
- Tras tocar datos en producción, el servidor guarda listas en memoria unos minutos: los cambios pueden tardar en verse.
- Los tests (npm test) no tocan ninguna base real.
- Lo que sube a main llega a producción en minutos; lo que está solo en develop (app) no llega a nadie hasta compilar.
- Ante la duda, pídeme que lo ejecute yo: primero te enseño el plan y no cambio nada sin tu OK.
