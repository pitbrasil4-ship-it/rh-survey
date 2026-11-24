'use strict';
const PDFDocument = require('pdfkit');
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');
const { earnedPct } = require('../utils/scoring');

const RELS = ['auto', 'gestor', 'par', 'subordinado'];

/* POST /eval/cycles  { name, surveyId } */
function createCycle(req, res) {
  try {
    const { name, surveyId } = req.body;
    if (!name || !surveyId) return badReq(res, 'Nome do ciclo e questionário são obrigatórios');
    const db = getDB();
    const survey = db.prepare('SELECT id FROM surveys WHERE id=? AND tenant_id=?').get(surveyId, req.user.tenant_id);
    if (!survey) return badReq(res, 'Questionário inválido');
    const id = uuid();
    db.prepare("INSERT INTO eval_cycles (id, tenant_id, name, survey_id) VALUES (?,?,?,?)").run(id, req.user.tenant_id, name, surveyId);
    const cycle = db.prepare('SELECT * FROM eval_cycles WHERE id=?').get(id);
    return created(res, { cycle }, 'Ciclo de avaliação criado');
  } catch (e) { return err(res, 'Erro ao criar ciclo', 500, e.message); }
}

/* GET /eval/cycles  — lista com progresso */
function listCycles(req, res) {
  try {
    const db = getDB();
    const cycles = db.prepare(`
      SELECT c.*, s.name AS survey_name,
        (SELECT COUNT(*) FROM eval_assignments WHERE cycle_id=c.id) AS total_assignments,
        (SELECT COUNT(*) FROM eval_assignments WHERE cycle_id=c.id AND completed=1) AS completed_assignments,
        (SELECT COUNT(DISTINCT subject_id) FROM eval_assignments WHERE cycle_id=c.id) AS subjects
      FROM eval_cycles c LEFT JOIN surveys s ON c.survey_id=s.id
      WHERE c.tenant_id=? ORDER BY c.created_at DESC
    `).all(req.user.tenant_id);
    return ok(res, { cycles });
  } catch (e) { return err(res, 'Erro ao listar ciclos', 500, e.message); }
}

/* GET /eval/cycles/:id — detalhe com avaliadores */
function getCycle(req, res) {
  try {
    const db = getDB();
    const cycle = db.prepare(`SELECT c.*, s.name AS survey_name FROM eval_cycles c LEFT JOIN surveys s ON c.survey_id=s.id WHERE c.id=? AND c.tenant_id=?`).get(req.params.id, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');
    const assignments = db.prepare(`
      SELECT a.id, a.subject_id, a.relationship, a.evaluator_name, a.evaluator_email, a.token, a.completed, a.created_at,
             r.name AS subject_name
      FROM eval_assignments a LEFT JOIN respondents r ON a.subject_id=r.id
      WHERE a.cycle_id=? ORDER BY r.name, a.created_at
    `).all(req.params.id);
    return ok(res, { cycle, assignments });
  } catch (e) { return err(res, 'Erro ao carregar ciclo', 500, e.message); }
}

/* POST /eval/cycles/:id/assignments  { subjectId, relationship, evaluatorName, evaluatorEmail } */
function addAssignment(req, res) {
  try {
    const { subjectId, relationship, evaluatorName, evaluatorEmail } = req.body;
    if (!subjectId || !relationship) return badReq(res, 'Avaliado e tipo de relação são obrigatórios');
    if (!RELS.includes(relationship)) return badReq(res, 'Relação inválida (use: auto, gestor, par, subordinado)');
    const db = getDB();
    const cycle = db.prepare('SELECT id FROM eval_cycles WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');
    const subject = db.prepare('SELECT id FROM respondents WHERE id=? AND tenant_id=?').get(subjectId, req.user.tenant_id);
    if (!subject) return badReq(res, 'Avaliado inválido');
    const id = uuid(); const token = uuid();
    db.prepare("INSERT INTO eval_assignments (id, cycle_id, subject_id, relationship, evaluator_name, evaluator_email, token) VALUES (?,?,?,?,?,?,?)")
      .run(id, req.params.id, subjectId, relationship, evaluatorName || null, evaluatorEmail || null, token);
    const assignment = db.prepare(`SELECT a.*, r.name AS subject_name FROM eval_assignments a LEFT JOIN respondents r ON a.subject_id=r.id WHERE a.id=?`).get(id);
    return created(res, { assignment }, 'Avaliador atribuído');
  } catch (e) { return err(res, 'Erro ao atribuir avaliador', 500, e.message); }
}

/* DELETE /eval/assignments/:id */
function removeAssignment(req, res) {
  try {
    const db = getDB();
    // garante que pertence a um ciclo do tenant
    const a = db.prepare(`SELECT a.id FROM eval_assignments a JOIN eval_cycles c ON a.cycle_id=c.id WHERE a.id=? AND c.tenant_id=?`).get(req.params.id, req.user.tenant_id);
    if (!a) return notFound(res, 'Atribuição');
    db.prepare('DELETE FROM eval_assignments WHERE id=?').run(req.params.id);
    return ok(res, {}, 'Atribuição removida');
  } catch (e) { return err(res, 'Erro ao remover atribuição', 500, e.message); }
}

/* GET /eval/results/:cycleId — matriz 360 (scores normalizados 0–100 por relação) */
function results(req, res) {
  try {
    const db = getDB();
    const cycle = db.prepare(`SELECT c.*, s.name AS survey_name FROM eval_cycles c LEFT JOIN surveys s ON c.survey_id=s.id WHERE c.id=? AND c.tenant_id=?`).get(req.params.cycleId, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');

    // Mapa das perguntas. A nota usa a MESMA regra da tela de Resultados (utils/scoring):
    // pesos por alternativa quando existem, alternativa neutra fora da conta.
    const questions = db.prepare('SELECT id, type, options, option_points FROM questions WHERE survey_id=?').all(cycle.survey_id);
    const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const qmap = {};
    questions.forEach(q => { qmap[q.id] = { type: q.type, options: PJ(q.options) || [], points: PJ(q.option_points) }; });

    const subjects = db.prepare(`
      SELECT DISTINCT a.subject_id AS id, r.name
      FROM eval_assignments a LEFT JOIN respondents r ON a.subject_id=r.id
      WHERE a.cycle_id=? ORDER BY r.name
    `).all(req.params.cycleId);

    // Anonimato: a nota de uma perspectiva só aparece com um mínimo de respostas (padrão 5).
    // A autoavaliação é exceção — é a própria pessoa, não há o que proteger.
    const minResp = Number(cycle.min_responses) > 0 ? Number(cycle.min_responses) : 5;
    const hidden = (rel, n) => rel !== 'auto' && n < minResp;

    const matrix = subjects.map(sub => {
      const row = { subjectId: sub.id, subjectName: sub.name || '—', counts: {}, hidden: {} };
      const allNorm = [];
      RELS.forEach(rel => {
        const rows = db.prepare(`
          SELECT an.value_num, an.value_json, an.value_text, an.question_id
          FROM answers an
          JOIN responses rp ON an.response_id=rp.id
          WHERE rp.survey_id=? AND rp.subject_id=? AND rp.relationship=? AND rp.completed_at IS NOT NULL
        `).all(cycle.survey_id, sub.id, rel);
        const norm = rows.map(x => {
          const q = qmap[x.question_id];
          return q ? earnedPct(q, x, q.options, q.points) : null;
        }).filter(v => v !== null);
        // Quantas PESSOAS responderam nesta perspectiva (não quantas respostas de perguntas).
        const people = db.prepare(`SELECT COUNT(*) c FROM responses WHERE survey_id=? AND subject_id=? AND relationship=? AND completed_at IS NOT NULL`)
          .get(cycle.survey_id, sub.id, rel).c;
        row.counts[rel] = people;
        const avg = norm.length ? Math.round(norm.reduce((a, b) => a + b, 0) / norm.length) : null;
        if (hidden(rel, people)) { row[rel] = null; row.hidden[rel] = true; }
        else row[rel] = avg;
        if (norm.length) allNorm.push(...norm);
      });
      // A nota geral junta todas as perspectivas, então já é agregada o bastante para aparecer.
      const totalPeople = RELS.reduce((s, r) => s + (row.counts[r] || 0), 0);
      row.totalResponses = totalPeople;
      row.overall = (allNorm.length && totalPeople >= minResp) ? Math.round(allNorm.reduce((a, b) => a + b, 0) / allNorm.length) : null;
      row.overallHidden = allNorm.length > 0 && totalPeople < minResp;
      return row;
    });
    return ok(res, { cycle, matrix, relationships: RELS, minResponses: minResp });
  } catch (e) { return err(res, 'Erro ao calcular resultados 360', 500, e.message); }
}

/* Monta o relatório individual de um avaliado: pergunta a pergunta, por perspectiva.
   Respeita o mínimo de respostas — abaixo dele a perspectiva não é revelada. */
function buildSubjectReport(db, cycle, subjectId) {
  const minResp = Number(cycle.min_responses) > 0 ? Number(cycle.min_responses) : 5;
  const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  const subject = db.prepare('SELECT id, name FROM respondents WHERE id=?').get(subjectId);
  const questions = db.prepare('SELECT id, type, text, options, option_points, order_num FROM questions WHERE survey_id=? ORDER BY order_num').all(cycle.survey_id);

  const counts = {}, visible = {};
  RELS.forEach(rel => {
    counts[rel] = db.prepare(`SELECT COUNT(*) c FROM responses WHERE survey_id=? AND subject_id=? AND relationship=? AND completed_at IS NOT NULL`)
      .get(cycle.survey_id, subjectId, rel).c;
    visible[rel] = rel === 'auto' ? counts[rel] > 0 : counts[rel] >= minResp;
  });
  const totalResponses = RELS.reduce((s, r) => s + counts[r], 0);

  const rows = db.prepare(`
    SELECT an.question_id, an.value_num, an.value_json, an.value_text, rp.relationship
    FROM answers an JOIN responses rp ON an.response_id=rp.id
    WHERE rp.survey_id=? AND rp.subject_id=? AND rp.completed_at IS NOT NULL
  `).all(cycle.survey_id, subjectId);

  const perguntas = questions.map(q => {
    const meta = { type: q.type, options: PJ(q.options) || [], points: PJ(q.option_points) };
    const item = { questionId: q.id, text: q.text, type: q.type, byRel: {}, comments: [] };
    let sum = 0, n = 0;
    RELS.forEach(rel => {
      const mine = rows.filter(r => r.question_id === q.id && r.relationship === rel);
      const vals = mine.map(r => earnedPct(meta, r, meta.options, meta.points)).filter(v => v !== null);
      if (!vals.length) { item.byRel[rel] = null; return; }
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      item.byRel[rel] = visible[rel] ? avg : null;
      if (!visible[rel]) item.byRel[rel + 'Hidden'] = true;
      sum += vals.reduce((a, b) => a + b, 0); n += vals.length;
    });
    item.overall = n && totalResponses >= minResp ? Math.round(sum / n) : null;
    // Comentários livres só aparecem com o mínimo atingido — texto identifica mais que nota.
    if (totalResponses >= minResp) {
      const skip = new Set(['true', 'false', 'sim', 'não', 'nao', 'yes', 'no', '1', '0']);
      item.comments = rows.filter(r => r.question_id === q.id && r.relationship !== 'auto' && r.value_text && String(r.value_text).trim() && !skip.has(String(r.value_text).trim().toLowerCase()))
        .map(r => String(r.value_text).trim());
    }
    return item;
  });

  const scored = perguntas.filter(p => p.overall !== null);
  const geral = scored.length ? Math.round(scored.reduce((a, p) => a + p.overall, 0) / scored.length) : null;
  const ranked = [...scored].sort((a, b) => b.overall - a.overall);

  return {
    cycleName: cycle.name, surveyName: cycle.survey_name,
    subject: { id: subjectId, name: (subject && subject.name) || '—' },
    minResponses: minResp, counts, visible, totalResponses,
    released: totalResponses >= minResp,
    perguntas, geral,
    melhores: ranked.slice(0, 3).map(p => ({ text: p.text, pct: p.overall })),
    piores: ranked.slice(-3).reverse().map(p => ({ text: p.text, pct: p.overall })),
  };
}

/* GET /eval/results/:cycleId/subject/:subjectId */
function subjectResults(req, res) {
  try {
    const db = getDB();
    const cycle = db.prepare(`SELECT c.*, s.name AS survey_name FROM eval_cycles c LEFT JOIN surveys s ON c.survey_id=s.id WHERE c.id=? AND c.tenant_id=?`).get(req.params.cycleId, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');
    return ok(res, buildSubjectReport(db, cycle, req.params.subjectId));
  } catch (e) { return err(res, 'Erro ao montar o relatório do avaliado', 500, e.message); }
}

/* GET /eval/results/:cycleId/subject/:subjectId/pdf — relatório individual para a devolutiva */
function subjectPdf(req, res) {
  try {
    const db = getDB();
    const cycle = db.prepare(`SELECT c.*, s.name AS survey_name FROM eval_cycles c LEFT JOIN surveys s ON c.survey_id=s.id WHERE c.id=? AND c.tenant_id=?`).get(req.params.cycleId, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');
    const rep = buildSubjectReport(db, cycle, req.params.subjectId);

    const NAVY = '#1E1B4B', PURPLE = '#5B21B6', SLATE = '#475569', LIGHT = '#64748B', LINE = '#EAECF3';
    const cor = p => p >= 70 ? '#16A34A' : p >= 40 ? '#D97706' : '#DC2626';
    const RELNAME = { auto: 'Autoavaliação', gestor: 'Gestor', par: 'Pares', subordinado: 'Equipe' };

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: 'Devolutiva - ' + rep.subject.name, Author: 'RH Survey' } });
    const safe = (rep.subject.name || 'avaliado').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'avaliado';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="devolutiva-${safe}.pdf"`);
    doc.pipe(res);
    const PW = doc.page.width, M = 50, CW = PW - M * 2;
    const need = h => { if (doc.y + h > doc.page.height - 55) doc.addPage(); };

    doc.rect(0, 0, PW, 96).fill(NAVY);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('RH Survey', M, 26);
    doc.fillColor('#C7CBE6').font('Helvetica').fontSize(10).text('Devolutiva individual  ·  Confidencial  ·  Conforme à LGPD', M, 54);
    doc.fillColor('#C7CBE6').fontSize(9).text(new Date().toLocaleDateString('pt-BR'), PW - M - 120, 30, { width: 120, align: 'right' });

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(rep.subject.name, M, 120, { width: CW });
    doc.fillColor(LIGHT).font('Helvetica').fontSize(10).text(`${rep.cycleName}${rep.surveyName ? ' · ' + rep.surveyName : ''}`, M, doc.y + 2, { width: CW });
    doc.moveDown(0.8);

    if (!rep.released) {
      doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(12)
        .text(`Resultado ainda não liberado: ${rep.totalResponses} de ${rep.minResponses} respostas necessárias.`, M, doc.y, { width: CW });
      doc.fillColor(LIGHT).font('Helvetica').fontSize(10)
        .text('O mínimo de respostas protege o anonimato de quem avaliou.', M, doc.y + 6, { width: CW });
      doc.end(); return;
    }

    // Cartões: nota geral + nota por perspectiva
    const cards = [['Nota geral', rep.geral != null ? rep.geral + '%' : '—']];
    RELS.forEach(r => { if (rep.visible[r] && rep.counts[r]) { const vals = rep.perguntas.map(p => p.byRel[r]).filter(v => v != null); if (vals.length) cards.push([RELNAME[r], Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) + '%']); } });
    const my = doc.y + 4, bw = CW / cards.length;
    cards.forEach((c, i) => {
      const x = M + i * bw;
      doc.roundedRect(x + (i ? 5 : 0), my, bw - 10, 58, 8).fillAndStroke('#F8FAFC', '#E6E9F2');
      doc.fillColor(i === 0 ? PURPLE : NAVY).font('Helvetica-Bold').fontSize(19).text(c[1], x + 14, my + 11, { width: bw - 28 });
      doc.fillColor(LIGHT).font('Helvetica').fontSize(8.5).text(c[0], x + 14, my + 39, { width: bw - 28 });
    });
    doc.y = my + 58 + 20;

    const lista = (titulo, itens, cr) => {
      if (!itens.length) return;
      need(30);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(titulo, M, doc.y); doc.moveDown(0.25);
      itens.forEach(it => { need(16); doc.fillColor(cr).font('Helvetica-Bold').fontSize(10).text(`${it.pct}%`, M + 4, doc.y, { width: 42, continued: false }); doc.moveUp(1); doc.fillColor(SLATE).font('Helvetica').fontSize(10).text(it.text, M + 50, doc.y, { width: CW - 50 }); });
      doc.moveDown(0.6);
    };
    lista('Pontos mais fortes', rep.melhores, '#16A34A');
    lista('Pontos a desenvolver', rep.piores, '#DC2626');

    need(26);
    doc.moveTo(M, doc.y).lineTo(M + CW, doc.y).strokeColor(LINE).lineWidth(1).stroke();
    doc.moveDown(0.6);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text('Resultado pergunta a pergunta', M, doc.y);
    doc.moveDown(0.4);

    rep.perguntas.forEach((p, i) => {
      need(44);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5).text(`${i + 1}. ${p.text}`, M, doc.y, { width: CW });
      doc.moveDown(0.2);
      const partes = [];
      if (p.overall != null) partes.push(['Geral', p.overall]);
      RELS.forEach(r => { if (p.byRel[r] != null) partes.push([RELNAME[r], p.byRel[r]]); });
      partes.forEach(([nome, pct]) => {
        need(14);
        const y = doc.y, barX = M + 150, barW = 200;
        doc.fillColor(LIGHT).font('Helvetica').fontSize(9).text(nome, M + 6, y, { width: 136 });
        doc.roundedRect(barX, y + 1, barW, 7, 3).fill('#EEF0F4');
        doc.roundedRect(barX, y + 1, Math.max(2, barW * Math.min(100, pct) / 100), 7, 3).fill(cor(pct));
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(pct + '%', barX + barW + 8, y, { width: 40 });
        doc.y = y + 13;
      });
      if (p.comments && p.comments.length) {
        doc.moveDown(0.2); need(16);
        doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(9).text(`Comentários (${p.comments.length}):`, M + 6, doc.y);
        p.comments.forEach(c => { need(14); doc.fillColor(SLATE).font('Helvetica').fontSize(9).text('•  ' + c, M + 12, doc.y, { width: CW - 24 }); });
      }
      doc.moveDown(0.5); need(6);
      doc.moveTo(M, doc.y).lineTo(M + CW, doc.y).strokeColor(LINE).lineWidth(1).stroke();
      doc.moveDown(0.5);
    });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fillColor(LIGHT).font('Helvetica').fontSize(8).text(`Confidencial · uso restrito à devolutiva    —    Página ${i + 1} de ${range.count}`, M, doc.page.height - 38, { width: CW, align: 'center' });
    }
    doc.end();
  } catch (e) { if (!res.headersSent) return err(res, 'Erro ao gerar a devolutiva', 500, e.message); try { res.end(); } catch {} }
}

/* POST /eval/cycles/:id/assignments/bulk — sobe a planilha de avaliadores de uma vez.
   Cada linha: { subjectName|subjectId, relationship, evaluatorName, evaluatorEmail } */
function bulkAssign(req, res) {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) return badReq(res, 'Envie ao menos uma linha');
    if (rows.length > 2000) return badReq(res, 'Máximo de 2000 linhas por vez');
    const db = getDB();
    const cycle = db.prepare('SELECT id FROM eval_cycles WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');

    const findSubj = db.prepare('SELECT id FROM respondents WHERE id=? AND tenant_id=?');
    const byName   = db.prepare('SELECT id FROM respondents WHERE LOWER(name)=LOWER(?) AND tenant_id=?');
    const insResp  = db.prepare('INSERT INTO respondents (id, tenant_id, name, consent_given) VALUES (?,?,?,1)');
    const exists   = db.prepare('SELECT id, token FROM eval_assignments WHERE cycle_id=? AND subject_id=? AND relationship=? AND IFNULL(evaluator_email,\'\')=IFNULL(?,\'\') AND IFNULL(evaluator_name,\'\')=IFNULL(?,\'\')');
    const ins      = db.prepare('INSERT INTO eval_assignments (id, cycle_id, subject_id, relationship, evaluator_name, evaluator_email, token) VALUES (?,?,?,?,?,?,?)');

    const criados = [], erros = [];
    db.exec('BEGIN');
    try {
      rows.forEach((r, i) => {
        const rel = String(r.relationship || '').trim().toLowerCase();
        if (!RELS.includes(rel)) { erros.push({ linha: i + 1, motivo: `relação inválida: "${r.relationship || ''}"` }); return; }
        let sid = null;
        if (r.subjectId && findSubj.get(r.subjectId, req.user.tenant_id)) sid = r.subjectId;
        else if (r.subjectName && String(r.subjectName).trim()) {
          const nome = String(r.subjectName).trim();
          const found = byName.get(nome, req.user.tenant_id);
          if (found) sid = found.id;
          else { sid = uuid(); insResp.run(sid, req.user.tenant_id, nome); }   // cadastra o avaliado que ainda não existe
        }
        if (!sid) { erros.push({ linha: i + 1, motivo: 'avaliado não informado' }); return; }
        const nomeAv = r.evaluatorName ? String(r.evaluatorName).trim() : null;
        const mailAv = r.evaluatorEmail ? String(r.evaluatorEmail).trim() : null;
        const já = exists.get(req.params.id, sid, rel, mailAv, nomeAv);
        if (já) { criados.push({ subjectId: sid, subjectName: r.subjectName || '', relationship: rel, evaluatorName: nomeAv, evaluatorEmail: mailAv, token: já.token, repetido: true }); return; }
        const id = uuid(), token = uuid();
        ins.run(id, req.params.id, sid, rel, nomeAv, mailAv, token);
        criados.push({ subjectId: sid, subjectName: r.subjectName || '', relationship: rel, evaluatorName: nomeAv, evaluatorEmail: mailAv, token });
      });
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    return created(res, { criados, erros }, `${criados.length} avaliador(es) atribuído(s)`);
  } catch (e) { return err(res, 'Erro ao atribuir em massa', 500, e.message); }
}

/* GET /eval/cycles/:id/pending — quem ainda não respondeu, para o lembrete */
function pendingList(req, res) {
  try {
    const db = getDB();
    const cycle = db.prepare('SELECT id FROM eval_cycles WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');
    const rows = db.prepare(`
      SELECT a.token, a.relationship, a.evaluator_name, a.evaluator_email, r.name AS subject_name
      FROM eval_assignments a LEFT JOIN respondents r ON a.subject_id = r.id
      WHERE a.cycle_id = ? AND IFNULL(a.completed,0) = 0
      ORDER BY r.name, a.evaluator_name
    `).all(req.params.id);
    return ok(res, { pending: rows, total: rows.length });
  } catch (e) { return err(res, 'Erro ao listar pendentes', 500, e.message); }
}

/* ───────── PÚBLICO (sem auth) — o avaliador responde ───────── */

/* GET /public/eval/:token */
function getEvalPublic(req, res) {
  try {
    const db = getDB();
    const a = db.prepare(`
      SELECT a.relationship, a.completed, a.subject_id,
             r.name AS subject_name, c.name AS cycle_name, c.survey_id, c.status AS cycle_status
      FROM eval_assignments a
      LEFT JOIN respondents r ON a.subject_id=r.id
      LEFT JOIN eval_cycles c ON a.cycle_id=c.id
      WHERE a.token=?
    `).get(req.params.token);
    if (!a || a.cycle_status !== 'ativo') return notFound(res, 'Avaliação');
    if (a.completed) return ok(res, { alreadyDone: true, subjectName: a.subject_name, relationship: a.relationship, cycleName: a.cycle_name });
    const questions = db.prepare('SELECT id, order_num, type, text, text_self, options, single_choice FROM questions WHERE survey_id=? ORDER BY order_num').all(a.survey_id);
    // Na autoavaliação a pergunta usa o texto em primeira pessoa, quando houver.
    const parsed = questions.map(q => ({
      id: q.id, order_num: q.order_num, type: q.type,
      text: (a.relationship === 'auto' && q.text_self && q.text_self.trim()) ? q.text_self : q.text,
      options: q.options ? JSON.parse(q.options) : null,
      singleChoice: !!q.single_choice,
    }));
    return ok(res, { subjectName: a.subject_name, relationship: a.relationship, cycleName: a.cycle_name, questions: parsed });
  } catch (e) { return err(res, 'Erro ao carregar avaliação', 500, e.message); }
}

/* POST /public/eval/:token  { answers } */
function submitEvalPublic(req, res) {
  try {
    const { answers } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length === 0) return badReq(res, 'Respostas são obrigatórias');
    const db = getDB();
    const a = db.prepare(`SELECT a.id, a.subject_id, a.relationship, a.completed, c.survey_id, c.status AS cycle_status FROM eval_assignments a LEFT JOIN eval_cycles c ON a.cycle_id=c.id WHERE a.token=?`).get(req.params.token);
    if (!a || a.cycle_status !== 'ativo') return notFound(res, 'Avaliação');
    if (a.completed) return badReq(res, 'Esta avaliação já foi respondida');

    const responseId = uuid();
    db.prepare('INSERT INTO responses (id, survey_id, respondent_id, ip_hash, subject_id, relationship) VALUES (?,?,?,?,?,?)')
      .run(responseId, a.survey_id, null, hashIP(req.ip || ''), a.subject_id, a.relationship);
    const stmt = db.prepare('INSERT INTO answers (id, response_id, question_id, value_text, value_num, value_json) VALUES (?,?,?,?,?,?)');
    answers.forEach(ans => {
      const isNum = typeof ans.value === 'number';
      const isArr = Array.isArray(ans.value);
      stmt.run(uuid(), responseId, ans.questionId,
        !isNum && !isArr ? String(ans.value) : null,
        isNum ? ans.value : null,
        isArr ? JSON.stringify(ans.value) : null);
    });
    db.prepare("UPDATE responses SET completed_at=datetime('now') WHERE id=?").run(responseId);
    db.prepare("UPDATE eval_assignments SET completed=1 WHERE id=?").run(a.id);
    return ok(res, { responseId }, 'Avaliação registrada. Obrigado!');
  } catch (e) { return err(res, 'Erro ao registrar avaliação', 500, e.message); }
}

module.exports = { createCycle, listCycles, getCycle, addAssignment, removeAssignment, results, subjectResults, subjectPdf, bulkAssign, pendingList, getEvalPublic, submitEvalPublic };
