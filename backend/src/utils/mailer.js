'use strict';
/* Envio de e-mail transacional.
 * - Com RESEND_API_KEY definido no ambiente: envia automático via Resend (https://resend.com).
 *   Opcional: MAIL_FROM (ex.: "RH Survey <rh@rgis.com>"). Sem domínio verificado, use o padrão
 *   "onboarding@resend.dev" (só entrega para o e-mail do dono da conta — bom para testar).
 * - Sem chave: retorna { sent:false, reason:'not_configured' } e o frontend oferece
 *   envio manual (mailto / copiar texto). */

async function sendMail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'RH Survey <onboarding@resend.dev>';
  if (!key) return { sent: false, reason: 'not_configured' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { sent: false, reason: (data && (data.message || data.error)) || ('HTTP ' + resp.status) };
    return { sent: true, id: data.id || null };
  } catch (e) { return { sent: false, reason: e.message }; }
}

/* Monta o e-mail de dados de acesso para um novo usuário. */
function accessEmail({ name, email, password, url }) {
  const appUrl = url || process.env.APP_URL || 'https://rh-survey.vercel.app';
  const subject = 'Seu acesso ao RH Survey';
  const text =
`Olá, ${name}!

Seu acesso à plataforma RH Survey foi criado.

Endereço: ${appUrl}
Login: ${email}
Senha provisória: ${password}

No primeiro acesso, o sistema vai pedir que você defina uma nova senha.

Este e-mail contém dados pessoais e credenciais — não repasse. Em conformidade com a LGPD.
RH Survey`;
  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1E1B4B">
  <div style="background:#1E1B4B;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0">
    <div style="font-size:18px;font-weight:bold">RH Survey</div>
    <div style="font-size:12px;color:#C7CBE6">Conforme à LGPD</div>
  </div>
  <div style="border:1px solid #E6E9F2;border-top:0;padding:24px;border-radius:0 0 12px 12px">
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Seu acesso à plataforma <strong>RH Survey</strong> foi criado.</p>
    <table style="font-size:14px;border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0;color:#64748B">Endereço:</td><td><a href="${appUrl}">${appUrl}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748B">Login:</td><td>${email}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748B">Senha provisória:</td><td><code style="background:#F1F5F9;padding:2px 8px;border-radius:6px">${password}</code></td></tr>
    </table>
    <p style="margin-top:16px">No primeiro acesso, o sistema vai pedir que você <strong>defina uma nova senha</strong>.</p>
    <p style="font-size:12px;color:#64748B">Este e-mail contém dados pessoais e credenciais — não repasse. Em conformidade com a LGPD.</p>
  </div>
</div>`;
  return { subject, text, html };
}

module.exports = { sendMail, accessEmail };
