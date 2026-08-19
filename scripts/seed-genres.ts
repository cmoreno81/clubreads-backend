/**
 * Script de utilidad: Poblar/actualizar iconos de géneros en la BD.
 *
 * Uso:
 *   npx tsx scripts/seed-genres.ts
 *
 * Qué hace:
 * - Para cada género de la lista, hace un upsert en la tabla Genre:
 *   · Si el género ya existe → actualiza su icon (solo si estaba vacío).
 *   · Si no existe → lo crea con el icon correspondiente.
 * - Es idempotente: se puede ejecutar N veces sin efectos secundarios.
 * - No toca ningún dato existente de libros ni borrar géneros.
 *
 * Cuándo usarlo:
 * - Tras un deploy fresco en un entorno nuevo.
 * - Para asegurarte de que todos los géneros tienen su icono relleno.
 * - Cuando añadas un género nuevo (edita GENRES y ejecuta de nuevo).
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL no está definida en las variables de entorno.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────
// Lista canónica de géneros con sus iconos
// Si añades un género nuevo en Flutter, añádelo aquí también.
// ─────────────────────────────────────────────
const GENRES: { name: string; icon: string }[] = [
  { name: 'Fantasía',              icon: '🐉' },
  { name: 'Romantasy',             icon: '🌹' },
  { name: 'Romance',               icon: '💕' },
  { name: 'Thriller',              icon: '🔪' },
  { name: 'Dark Romance',          icon: '🖤' },
  { name: 'Dark Academia',         icon: '🎓' },
  { name: 'Drama',                 icon: '🎭' },
  { name: 'Clásicos',              icon: '📜' },
  { name: 'Distopía',              icon: '🌇' },
  { name: 'Novela contemporánea',  icon: '🏙️' },
  { name: 'Novela Histórica',      icon: '🏰' },
  { name: 'Ciencia Ficción',       icon: '🚀' },
  { name: 'Terror',                icon: '👻' },
  { name: 'Novela Negra',          icon: '🕵️' },
  { name: 'Cómic',                 icon: '💬' },
  { name: 'No ficción',            icon: '🧠' },
  { name: 'Infantil',              icon: '🎈' },
  { name: 'Mafia Romance',         icon: '🌹🔫' },
];

async function main() {
  console.log('🌱 Iniciando seed de géneros…\n');

  let creados = 0;
  let actualizados = 0;
  let sinCambios = 0;

  for (const { name, icon } of GENRES) {
    const existente = await prisma.genre.findUnique({
      where: { name },
      select: { id: true, icon: true },
    });

    if (!existente) {
      // Crear género nuevo
      await prisma.genre.create({
        data: { name, icon },
      });
      console.log(`  ✅ Creado:      ${icon}  ${name}`);
      creados++;
    } else if (!existente.icon || existente.icon.trim() === '') {
      // Rellenar icono vacío
      await prisma.genre.update({
        where: { name },
        data: { icon },
      });
      console.log(`  🔄 Actualizado: ${icon}  ${name}`);
      actualizados++;
    } else {
      // Ya tiene icono → no tocar
      console.log(`  ⏭️  Sin cambios: ${existente.icon}  ${name}`);
      sinCambios++;
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Creados:      ${creados}`);
  console.log(`🔄 Actualizados: ${actualizados}`);
  console.log(`⏭️  Sin cambios:  ${sinCambios}`);
  console.log('─────────────────────────────────────────');
  console.log('Seed completado.\n');
}

main()
  .catch((err) => {
    console.error('❌ Error durante el seed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
