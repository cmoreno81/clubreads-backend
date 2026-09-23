/**
 * Rellena la notificación "Herramientas de Clubvisión para admins"
 * (notifyClubInfoAdminClubvision) para las admins/owners de clubes sociales
 * que ya existían antes de que esa notificación se mandara al crear un club
 * — si no, esas personas nunca se enteran de que pueden forzar candidatas a
 * mano. Idempotente (la propia función no duplica), así que se puede
 * ejecutar más de una vez sin problema.
 *
 * Uso: npx tsx scripts/backfill-clubvision-admin-info.ts
 */
import { ClubRole, ClubType } from '@prisma/client';
import { prisma } from '../src/prisma.js';
import { notifyClubInfoAdminClubvision } from '../src/services/notifications.service.js';

async function main() {
  const admins = await prisma.clubMember.findMany({
    where: {
      role: { in: [ClubRole.OWNER, ClubRole.ADMIN] },
      club: { tipo: ClubType.SOCIAL },
    },
    select: { clubId: true, userId: true },
  });

  console.log(`Admins/owners de clubes sociales encontrados: ${admins.length}`);

  let enviados = 0;
  for (const { clubId, userId } of admins) {
    try {
      await notifyClubInfoAdminClubvision(clubId, userId);
      enviados += 1;
    } catch (error) {
      console.error(`Fallo con club ${clubId} / usuario ${userId}:`, error);
    }
  }

  console.log(`✅ Procesados: ${enviados} (la función es idempotente, así que algunos pueden no haber generado notificación nueva)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
