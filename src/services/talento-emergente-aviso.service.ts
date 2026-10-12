import { observeExternalCall } from '../logging/external-call.js';

/// Avisa por correo a Cris de que hay una ficha nueva por revisar. Si Brevo no
/// está configurado (desarrollo, pruebas) no hace nada: la ficha ya está
/// guardada y se ve con `npm run talento:listar`.
export async function avisarNuevaFichaTalento(ficha: {
  id: string;
  titulo: string;
  autora: string;
}) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const remitente = process.env.AUTH_EMAIL_FROM?.trim();
  const destino = process.env.TALENTO_NOTIFY_EMAIL?.trim();
  if (!apiKey || !remitente || !destino) return;
  if ((process.env.AUTH_EMAIL_MODE ?? 'send') !== 'send') return;

  const response = await observeExternalCall('brevo', 'talento_new_submission', () =>
    fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: remitente, name: 'ClubReads' },
        to: [{ email: destino }],
        subject: 'Nueva ficha de Talento emergente',
        textContent: `Ha llegado una ficha nueva por revisar.\n\nLibro: ${ficha.titulo}\nAutora/autor: ${ficha.autora}\nId: ${ficha.id}\n\nPídeme que la revise y la apruebo.`,
        tags: ['talento-emergente'],
      }),
    }),
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Brevo rechazó el aviso (${response.status})`);
  }
}
