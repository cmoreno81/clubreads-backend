import { observeExternalCall } from '../logging/external-call.js';
import { logger } from '../logging/logger.js';

export type FeedbackCategory = 'bug' | 'sugerencia' | 'pregunta';

export interface FeedbackParams {
  /** Email de quien reporta (puede ser vacío si no está autenticada) */
  reporterEmail: string;
  reporterName: string;
  category: FeedbackCategory;
  titulo: string;
  descripcion: string;
}

export interface FeedbackResult {
  ok: boolean;
  ticketKey: string | null; // ej: "CLUB-12" o null si Jira no está configurado
  mensaje: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Jira
// ─────────────────────────────────────────────────────────────────────────────

function jiraConfig() {
  const domain = process.env.JIRA_DOMAIN?.trim();      // ej: "miclubapp.atlassian.net"
  const email = process.env.JIRA_EMAIL?.trim();        // email del admin de Jira
  const token = process.env.JIRA_API_TOKEN?.trim();    // API token de Jira
  const project = process.env.JIRA_PROJECT_KEY?.trim(); // ej: "CLUB"
  if (!domain || !email || !token || !project) return null;
  return { domain, email, token, project };
}

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  sugerencia: 'Sugerencia',
  pregunta: 'Pregunta',
};

const CATEGORY_EMOJI: Record<FeedbackCategory, string> = {
  bug: '🐛',
  sugerencia: '💡',
  pregunta: '❓',
};

const JIRA_ISSUE_TYPE: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  sugerencia: 'Task',
  pregunta: 'Task',
};

async function createJiraIssue(params: FeedbackParams): Promise<string | null> {
  const cfg = jiraConfig();
  if (!cfg) {
    logger.warn('Jira no configurado — se omite la creación del ticket');
    return null;
  }

  const credentials = Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');
  const emoji = CATEGORY_EMOJI[params.category];
  const label = CATEGORY_LABELS[params.category];
  const issueType = JIRA_ISSUE_TYPE[params.category];

  // Jira Atlassian Document Format (ADF) para la descripción
  const descriptionAdf = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `📱 `, marks: [] },
          { type: 'text', text: 'Reportado desde ClubReads', marks: [{ type: 'strong' }] },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `👤 `, marks: [] },
          { type: 'text', text: params.reporterName },
          { type: 'text', text: ` <${params.reporterEmail}>` },
        ],
      },
      { type: 'rule' },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: params.descripcion }],
      },
    ],
  };

  const body = {
    fields: {
      project: { key: cfg.project },
      summary: `${emoji} [${label}] ${params.titulo}`,
      description: descriptionAdf,
      issuetype: { name: issueType },
      labels: ['clubreads-app', params.category],
    },
  };

  const response = await observeExternalCall('jira', 'create_issue', () =>
    fetch(`https://${cfg.domain}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error({ status: response.status, body: text }, 'Error creando issue en Jira');
    return null;
  }

  const data = (await response.json()) as { key?: string };
  return data.key ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email de confirmación (Brevo)
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendConfirmationEmail(
  params: FeedbackParams,
  ticketKey: string | null,
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.AUTH_EMAIL_FROM?.trim();
  const senderName = process.env.AUTH_EMAIL_FROM_NAME?.trim() || 'ClubReads';

  if (!apiKey || !senderEmail || !params.reporterEmail) return;

  const label = CATEGORY_LABELS[params.category];
  const emoji = CATEGORY_EMOJI[params.category];
  const ticketLine = ticketKey
    ? `<p>Tu número de seguimiento es <strong style="font-size:20px;color:#5E347C">#${escapeHtml(ticketKey)}</strong>. Guárdalo por si quieres hacer referencia a tu reporte.</p>`
    : '<p>Tu mensaje ha sido recibido y lo revisaremos pronto.</p>';

  const html = [
    `<p>Hola, ${escapeHtml(params.reporterName)} 👋</p>`,
    `<p>Hemos recibido tu ${escapeHtml(label.toLowerCase())}:</p>`,
    `<blockquote style="border-left:3px solid #5E347C;padding-left:12px;color:#555">`,
    `<strong>${escapeHtml(params.titulo)}</strong><br>`,
    `<span style="font-size:14px">${escapeHtml(params.descripcion)}</span>`,
    `</blockquote>`,
    ticketLine,
    `<p>Gracias por ayudarnos a mejorar ClubReads. 📚</p>`,
  ].join('');

  const textContent = [
    `Hola, ${params.reporterName}.`,
    '',
    `Hemos recibido tu ${label.toLowerCase()}:`,
    `"${params.titulo}"`,
    params.descripcion,
    '',
    ticketKey ? `Tu número de seguimiento: #${ticketKey}` : 'Tu mensaje ha sido recibido.',
    '',
    'Gracias por ayudarnos a mejorar ClubReads.',
  ].join('\n');

  await observeExternalCall('brevo', 'send_feedback_confirmation', () =>
    fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: params.reporterEmail, name: params.reporterName }],
        subject: ticketKey
          ? `${emoji} [#${ticketKey}] Hemos recibido tu ${label.toLowerCase()}`
          : `${emoji} Hemos recibido tu ${label.toLowerCase()}`,
        htmlContent: html,
        textContent,
        tags: ['feedback', params.category],
      }),
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────────────────────

export async function enviarFeedback(params: FeedbackParams): Promise<FeedbackResult> {
  // Crea el ticket en Jira (si está configurado)
  const ticketKey = await createJiraIssue(params).catch((err) => {
    logger.error(err, 'Error inesperado creando ticket Jira');
    return null;
  });

  // Envía email de confirmación (no lanza error si falla)
  await sendConfirmationEmail(params, ticketKey).catch((err) => {
    logger.warn(err, 'No se pudo enviar email de confirmación de feedback');
  });

  return {
    ok: true,
    ticketKey,
    mensaje: ticketKey
      ? `Reporte registrado con el código #${ticketKey}`
      : 'Reporte recibido. Lo revisaremos pronto.',
  };
}
