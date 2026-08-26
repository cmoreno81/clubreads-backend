/**
 * Script puntual para forzar la sincronización de clichés de Casa del Libro.
 * Ahora importa los libros de cada sección directamente (no requiere que
 * ya estén en la base de datos desde el feed de novedades).
 *
 * Uso: npx tsx scripts/sync-cliches-now.ts
 */
import { syncCasaDelLibroCliches } from '../src/services/upcoming-release-sync.service.js';

const url =
  process.env.CASA_DEL_LIBRO_CLICHES_URL ??
  'https://www.casadellibro.com/libros-juveniles-segun-su-cliche';

console.log(`Sincronizando clichés desde:\n  ${url}\n`);
console.log('(Descargando ficha de cada producto — puede tardar unos minutos)\n');

const result = await syncCasaDelLibroCliches(url);
console.log(`✅ Finalizado:`);
console.log(`   Links extraídos de la página: ${result.links}`);
console.log(`   Registros de cliché creados:  ${result.tagged}`);
