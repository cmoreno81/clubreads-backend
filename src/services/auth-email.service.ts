import { observeExternalCall } from '../logging/external-call.js';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type SendCodeParams = {
  to: string;
  name: string;
  code: string;
  purpose: 'ACTIVATE' | 'REGISTER' | 'RESET_PASSWORD';
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
  const emailMode = process.env.AUTH_EMAIL_MODE ?? (
    process.env.NODE_ENV === 'production' ? 'send' : 'disabled'
  );
  if (emailMode === 'capture') {
    const configuredDirectory = process.env.AUTH_CODE_CAPTURE_DIR?.trim();
    if (!configuredDirectory) {
      throw new Error('AUTH_CODE_CAPTURE_DIR es obligatorio en modo capture');
    }
    const directory = resolve(configuredDirectory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const safeId = params.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const output = join(directory, `${safeId}.json`);
    await writeFile(output, JSON.stringify({
      to: params.to,
      name: params.name,
      code: params.code,
      purpose: params.purpose,
      capturedAt: new Date().toISOString(),
    }), { mode: 0o600, flag: 'wx' });
    return;
  }
  if (emailMode === 'disabled') return;
  if (emailMode !== 'send') {
    throw new Error('AUTH_EMAIL_MODE debe ser send, capture o disabled');
  }
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.AUTH_EMAIL_FROM?.trim();
  const senderName =
    process.env.AUTH_EMAIL_FROM_NAME?.trim() || 'Club de Lectura';

  if (!apiKey || !senderEmail) {
    throw new Error(
      'Faltan BREVO_API_KEY o AUTH_EMAIL_FROM para enviar correos',
    );
  }

  const isPasswordReset = params.purpose === 'RESET_PASSWORD';
  const subject = isPasswordReset
    ? 'Código para cambiar tu contraseña'
    : params.purpose === 'REGISTER'
      ? 'Verifica tu cuenta de ClubReads'
      : 'Activa tu acceso a ClubReads';
  const intro = isPasswordReset
    ? 'Usa este código para elegir una contraseña nueva.'
    : params.purpose === 'REGISTER'
      ? 'Usa este código para verificar tu correo y crear tu cuenta.'
      : 'Usa este código para activar tu cuenta y elegir una contraseña.';
  const safeName = escapeHtml(params.name);
  const safeCode = escapeHtml(params.code);

  const response = await observeExternalCall('brevo', 'send_auth_code', () =>
    fetch('https://api.brevo.com/v3/smtp/email', {
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
  }),
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Brevo rechazó el correo (${response.status})`);
  }
}
