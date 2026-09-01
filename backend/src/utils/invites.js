'use strict';
/* Convites de pesquisa: montagem do e-mail e disparo pelo servidor.
 *
 * Cada convite tem um token próprio (link de uso único). Isso é o que permite
 * saber quem abriu, quem respondeu e para quem mandar lembrete — sem quebrar o
 * anonimato: o convite guarda o e-mail, a resposta guarda apenas o distrito.  */

const { sendMail } = require('./mailer');

function appUrl() {
  return (process.env.APP_URL || 'https://rh-survey.vercel.app').replace(/\/+$/, '');
}

function inviteLink(token) {
  return `${appUrl()}/r/${encodeURIComponent(token)}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* Corpo do convite (primeiro envio) e do lembrete. */
function inviteEmail({ name, surveyName, link, deadline, anonymous, reminder }) {
  const prazo = deadline
    ? new Date(deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  const subject = reminder
    ? `Lembrete: ${surveyName}`
    : `Convite: ${surveyName}`;

  const abertura = reminder
    ? 'Notamos que você ainda não respondeu esta pesquisa. Se puder reservar alguns minutos, sua participação faz diferença.'
    : 'Você foi convidado(a) a participar da pesquisa abaixo.';

  const text =
`Olá, ${name || ''}!

${abertura}

Pesquisa: ${surveyName}
Link (uso individual): ${link}
${prazo ? `Prazo para responder: ${prazo}\n` : ''}${anonymous ? 'Suas respostas são anônimas — o link identifica apenas que o convite foi respondido, nunca o conteúdo das respostas.\n' : ''}
Este link é pessoal e aceita uma única resposta. Não repasse.

Tratamento de dados conforme a Lei nº 13.709/2018 (LGPD).
RH Survey`;

  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1E1B4B">
  <div style="background:#1E1B4B;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0">
    <div style="font-size:18px;font-weight:bold">RH Survey</div>
    <div style="font-size:12px;color:#C7CBE6">Conforme à LGPD</div>
  </div>
  <div style="border:1px solid #E6E9F2;border-top:0;padding:24px;border-radius:0 0 12px 12px">
    <p>Olá, <strong>${esc(name || '')}</strong>!</p>
    <p>${esc(abertura)}</p>
    <p style="font-size:16px;font-weight:bold;margin:18px 0 6px">${esc(surveyName)}</p>
    ${prazo ? `<p style="color:#64748B;font-size:13px;margin:0 0 16px">Prazo para responder: <strong>${prazo}</strong></p>` : ''}
    <p style="margin:20px 0">
      <a href="${esc(link)}" style="background:#DC2626;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:bold;display:inline-block">Responder a pesquisa</a>
    </p>
    <p style="font-size:12px;color:#64748B">Ou copie este endereço: <br><span style="word-break:break-all">${esc(link)}</span></p>
    ${anonymous ? '<p style="font-size:12px;color:#16A34A">Suas respostas são anônimas — o link registra apenas que o convite foi respondido, nunca o conteúdo das respostas.</p>' : ''}
    <p style="font-size:12px;color:#64748B">Este link é pessoal e aceita uma única resposta. Não repasse.</p>
  </div>
</div>`;

  return { subject, text, html };
}

/* Envia um convite e devolve { sent, reason }. */
async function sendInvite(invitation, survey, reminder) {
  const mail = inviteEmail({
    name: invitation.name,
    surveyName: survey.name,
    link: inviteLink(invitation.token),
    deadline: survey.deadline,
    anonymous: !!survey.anonymous,
    reminder,
  });
  return sendMail({ to: invitation.email, subject: mail.subject, html: mail.html, text: mail.text });
}

module.exports = { appUrl, inviteLink, inviteEmail, sendInvite };
