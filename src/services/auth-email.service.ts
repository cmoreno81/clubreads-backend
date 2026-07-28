type SendCodeParams = {
  to: string;
  name: string;
  code: string;
  purpose: 'ACTIVATE' | 'RESET_PASSWORD';
  idempotencyKey: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function sendAuthCodeEmail(params: SendCodeParams) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.AUTH_EMAIL_FROM?.trim();
  const senderName =
    process.env.AUTH_EMAIL_FROM_NAME?.trim() || 'Club de Lectura';

  if (!apiKey || !senderEmail) {
    throw new Error(
      'Faltan BREVO_API_KEY o AUTH_EMAIL_FROM para enviar correos',
    );
  }

  const isActivation = params.purpose === 'ACTIVATE';
  const subject = isActivation
    ? 'Activa tu acceso a Club de Lectura'
    : 'Código para cambiar tu contraseña';
  const intro = isActivation
    ? 'Usa este código para activar tu cuenta y elegir una contraseña.'
    : 'Usa este código para elegir una contraseña nueva.';
  const safeName = escapeHtml(params.name);
  const safeCode = escapeHtml(params.code);

  const response = await fetch(
    'https://api.brevo.com/v3/smtp/email',
    {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: senderName,
      },
      to: [{ email: params.to, name: params.name }],
      subject,
      textContent: `Hola, ${params.name}.\n\n${intro}\n\nCódigo: ${params.code}\n\nCaduca en 10 minutos. Si no lo has solicitado, puedes ignorar este mensaje.`,
      htmlContent: [
        `<p>Hola, ${safeName}.</p>`,
        `<p>${intro}</p>`,
        `<p style="font-size:32px;font-weight:700;letter-spacing:8px">${safeCode}</p>`,
        '<p>Caduca en 10 minutos. Si no lo has solicitado, puedes ignorar este mensaje.</p>',
      ].join(''),
      headers: {
        'X-Auth-Request-Id': params.idempotencyKey,
      },
      tags: [
        'authentication',
        params.purpose.toLowerCase(),
      ],
    }),
  },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Brevo rechazó el correo (${response.status}): ${detail}`,
    );
  }
}
