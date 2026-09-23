/* Exportações do relatório: XLSX (planilha) e PPTX (apresentação).
 *
 * A diferença que importa na apresentação: os gráficos são OBJETOS DE GRÁFICO do
 * PowerPoint, com a tabela de dados por trás, não imagens. Quem recebe o arquivo edita
 * rótulo, cor e recorte sem voltar aqui pedir outra versão — que era justamente o
 * trabalho manual que o RH fazia depois de cada apuração.
 *
 * O pptxgenjs é pesado e só serve na hora de exportar: entra por import dinâmico, para
 * não pesar no carregamento do painel. */

import * as XLSX from 'xlsx';

const RGIS   = 'C8102E';   // vermelho RGIS
const VERDE  = '16A34A';
const AMBAR  = 'F59E0B';
const VERMELHO = 'DC2626';
const CINZA  = '64748B';

const SEM_COLOR = { verde: VERDE, amarelo: AMBAR, vermelho: VERMELHO };
/* Rótulo de coluna: "75% favorável" é frase, mas cabeçalho de planilha começa em
   maiúscula. Reaproveita a mesma chave em vez de duplicar a tradução. */
const Cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const favOf = x => (x && x.favorability ? x.favorability.favorablePct : null);
const semOf = x => (x && x.favorability ? x.favorability.semaforo : null);

/* Nome de arquivo que o navegador aceita: sem acento, sem espaço, sem símbolo. */
export function slug(name, fallback) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 50) || fallback;
}

/* ─── XLSX ────────────────────────────────────────────────────────────────────
   Uma aba por pergunta de análise: o resumo, as dimensões, as perguntas com a
   distribuição rotulada, e os recortes. Tudo com favorabilidade e semáforo, que é
   como o relatório é lido hoje. */
export function buildWorkbook({ survey, result, seg, segQuestions, t }) {
  const wb = XLSX.utils.book_new();
  const semLabel = s => (s ? t('qr_sem_' + s) : '—');
  const add = (rows, cols, sheetName) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (cols) ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  };

  // ── Resumo ──
  const fav = result?.favorability;
  const resumo = [
    [survey?.name || t('rep_sheet_summary')],
    [],
    [t('rd_responses'), result?.survey?.totalResponses ?? 0],
    [t('rd_completion'), (result?.completionRate ?? 0) + '%'],
  ];
  if (fav) {
    resumo.push(
      [Cap(t('qr_favorable')), fav.favorablePct + '%'],
      [Cap(t('qr_unfavorable')), fav.unfavorablePct + '%'],
      [t('qr_semaforo'), semLabel(fav.semaforo)],
      [t('qr_base_questions', { n: fav.questions })],
    );
  }
  if (result?.overallScore != null) resumo.push([t('rd_overall_score'), result.overallScore + '%']);
  if (result?.overallNPS) resumo.push(['NPS', result.overallNPS.nps, result.overallNPS.classification]);
  if (seg?.totals?.geral) {
    const g = seg.totals.geral;
    resumo.push([t('seg_participation'), (g.pct ?? 0) + '%', `${g.responses || 0}/${g.meta || 0}`]);
  }
  resumo.push([], [t('rep_generated_at'), new Date().toLocaleString('pt-BR')]);
  add(resumo, [{ wch: 30 }, { wch: 18 }, { wch: 18 }], t('rep_sheet_summary'));

  // ── Dimensões ──
  const dims = result?.dimensions || [];
  if (dims.length) {
    const rows = [[t('qe_dimensions'), t('dm_set'), Cap(t('qr_favorable')), Cap(t('qr_unfavorable')), t('qr_semaforo'), t('rd_dim_n_q', { n: '' }).trim(), t('rd_responses')]];
    dims.forEach(d => rows.push([
      d.name, d.set || '', favOf(d) == null ? '—' : favOf(d) + '%',
      d.favorability ? d.favorability.unfavorablePct + '%' : '—',
      semLabel(semOf(d)), d.questions, d.responses,
    ]));
    add(rows, [{ wch: 34 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 11 }], t('qe_dimensions'));
  }

  // ── Perguntas ──
  const qs = result?.questions || [];
  if (qs.length) {
    const rows = [[t('rep_question'), t('csv_type'), t('qe_dimensions'), t('rd_responses'),
                   Cap(t('qr_favorable')), Cap(t('qr_unfavorable')), t('qr_semaforo'), t('rep_option'), t('csv_count'), t('rep_choice_pct')]];
    qs.forEach(q => {
      const base = [q.text, t('type_' + q.type), (q.dimensions || []).map(d => d.name).join(' · '),
                    q.responseCount ?? 0,
                    favOf(q) == null ? '—' : favOf(q) + '%',
                    q.favorability ? q.favorability.unfavorablePct + '%' : '—',
                    semLabel(semOf(q))];
      const dist = q.distribution || q.choices || [];
      if (dist.length) dist.forEach((c, i) => rows.push([...(i === 0 ? base : ['', '', '', '', '', '', '']), c.label, c.count ?? '', (c.pct ?? 0) + '%']));
      else rows.push([...base, '', '', '']);
    });
    add(rows, [{ wch: 52 }, { wch: 14 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 26 }, { wch: 9 }, { wch: 9 }],
        t('rep_sheet_questions'));
  }

  // ── Recortes ──
  const segs = result?.segments || {};
  const blocos = [
    ['modalidade', result?.segmentation ? t('rd_seg_modalidade') : null],
    ['distrito', t('rd_seg_distrito')], ['regional', t('rd_seg_regional')], ['departamento', t('rd_seg_departamento')],
  ].filter(([k, label]) => label && (segs[k] || []).length);
  if (blocos.length) {
    const rows = [[t('rep_level'), t('rep_segment'), t('rd_responses'), Cap(t('qr_favorable')), Cap(t('qr_unfavorable')), t('qr_semaforo')]];
    blocos.forEach(([k, label]) => {
      (segs[k] || []).forEach(sg => rows.push([
        label, sg.label, sg.responses,
        favOf(sg) == null ? '—' : favOf(sg) + '%',
        sg.favorability ? sg.favorability.unfavorablePct + '%' : '—',
        semLabel(semOf(sg)),
      ]));
    });
    add(rows, [{ wch: 16 }, { wch: 30 }, { wch: 11 }, { wch: 12 }, { wch: 14 }, { wch: 12 }], t('rd_segments'));
  }

  // ── Participação pela estrutura (meta cadastrada × respostas) ──
  if (seg) {
    const metric = seg.metric;
    const fmt = v => v == null ? '—' : (metric === 'score' ? v + '%' : metric === 'nps' ? 'NPS ' + v : String(v));
    const rows = [[t('rep_level'), t('rep_segment'), t('rep_final_score'), t('rd_responses'), t('org_meta'), t('seg_participation')]];
    const g = seg.totals.geral;
    rows.push([t('seg_corp'), '—', fmt(g.score), g.responses, g.meta, (g.pct ?? 0) + '%']);
    (seg.regionais || []).forEach(rg => {
      rows.push([t('org_regionais'), rg.name || t('seg_no_regional'), fmt(rg.score), rg.responses, rg.meta, (rg.pct ?? 0) + '%']);
      (rg.distritos || []).forEach(d => rows.push([t('org_distritos'), d.name, fmt(d.score), d.responses, d.meta, (d.pct ?? 0) + '%']));
    });
    (seg.departamentos || []).forEach(d => rows.push([t('org_departamentos'), d.name, fmt(d.score), d.responses, d.meta, (d.pct ?? 0) + '%']));
    add(rows, [{ wch: 16 }, { wch: 28 }, { wch: 13 }, { wch: 11 }, { wch: 8 }, { wch: 14 }], t('seg_participation'));
  }

  // ── Matriz pergunta × segmento ──
  const sq = segQuestions;
  if (sq && (sq.questions || []).length) {
    const list = sq.questions;
    const cell = (scores, qid) => (scores && scores[qid] != null) ? scores[qid] + '%' : '—';
    const rows = [[t('rep_segment'), ...list.map(q => q.text)]];
    rows.push([t('seg_corp'), ...list.map(q => cell(sq.corporacao, q.id))]);
    (sq.regionais || []).forEach(rg => {
      rows.push([`${t('org_regionais')}: ${rg.name || t('seg_no_regional')}`, ...list.map(q => cell(rg.scores, q.id))]);
      (rg.distritos || []).forEach(d => rows.push([`   ${d.name}`, ...list.map(q => cell(d.scores, q.id))]));
    });
    (sq.departamentos || []).forEach(d => rows.push([`${t('org_departamentos')}: ${d.name}`, ...list.map(q => cell(d.scores, q.id))]));
    add(rows, [{ wch: 28 }, ...list.map(() => ({ wch: 16 }))], t('rep_sheet_matrix'));
  }

  return wb;
}

export function exportXLSX({ survey, result, seg, segQuestions, t }) {
  const wb = buildWorkbook({ survey, result, seg, segQuestions, t });
  XLSX.writeFile(wb, `relatorio-${slug(survey?.name, 'pesquisa')}.xlsx`);
}

/* ─── PPTX ────────────────────────────────────────────────────────────────────
   Apresentação pronta para a reunião de devolutiva, com gráficos nativos. */
export async function exportPPTX({ survey, result, t, lang }) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'RH Survey';
  pptx.title  = survey?.name || 'Relatório';

  const semLabel = s => (s ? t('qr_sem_' + s) : '—');
  const titulo = (slide, texto, sub) => {
    slide.addText(texto, { x: 0.5, y: 0.35, w: 9, h: 0.5, fontSize: 24, bold: true, color: '1E293B' });
    if (sub) slide.addText(sub, { x: 0.5, y: 0.88, w: 9, h: 0.3, fontSize: 12, color: CINZA });
  };

  // ── Capa ──
  const capa = pptx.addSlide();
  capa.background = { color: 'FFFFFF' };
  capa.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 5.63, fill: { color: RGIS } });
  capa.addText(survey?.name || 'Relatório', { x: 0.8, y: 1.9, w: 8.6, h: 0.9, fontSize: 32, bold: true, color: '1E293B' });
  capa.addText([
    { text: t('rd_responses') + ': ', options: { color: CINZA } },
    { text: String(result?.survey?.totalResponses ?? 0), options: { bold: true, color: '1E293B' } },
    { text: '   ·   ' + t('rep_generated_at') + ': ', options: { color: CINZA } },
    { text: new Date().toLocaleDateString('pt-BR'), options: { color: '1E293B' } },
  ], { x: 0.8, y: 2.9, w: 8.6, h: 0.4, fontSize: 13 });

  // ── Favorabilidade geral ──
  const fav = result?.favorability;
  if (fav) {
    const s = pptx.addSlide();
    titulo(s, t('qr_favorable'), t('qr_base_questions', { n: fav.questions }));
    s.addChart(pptx.ChartType.doughnut, [{
      name: t('qr_favorable'),
      labels: [t('qr_favorable'), t('qr_unfavorable')],
      values: [fav.favorablePct, fav.unfavorablePct],
    }], {
      x: 0.6, y: 1.4, w: 4.4, h: 3.7, holeSize: 55,
      chartColors: [VERDE, VERMELHO], showPercent: false, showValue: true,
      dataLabelFormatCode: '0"%"', showLegend: true, legendPos: 'b',
    });
    s.addText(`${fav.favorablePct}%`, { x: 5.4, y: 1.8, w: 4, h: 1, fontSize: 54, bold: true, color: VERDE });
    s.addText(t('qr_favorable'), { x: 5.4, y: 2.75, w: 4, h: 0.4, fontSize: 14, color: CINZA });
    s.addShape(pptx.ShapeType.roundRect, { x: 5.4, y: 3.3, w: 2.2, h: 0.5, fill: { color: SEM_COLOR[fav.semaforo] || CINZA }, rectRadius: 0.24 });
    s.addText(semLabel(fav.semaforo), { x: 5.4, y: 3.3, w: 2.2, h: 0.5, fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
    s.addText(t('qr_semaforo_hint'), { x: 5.4, y: 3.95, w: 4, h: 0.8, fontSize: 10, color: CINZA });
  }

  // ── Dimensões ──
  const dims = (result?.dimensions || []).filter(d => favOf(d) != null);
  if (dims.length) {
    // Em conjuntos separados: a taxonomia de Clima e a de HSE não se somam.
    const porConjunto = {};
    dims.forEach(d => (porConjunto[d.set || '—'] = porConjunto[d.set || '—'] || []).push(d));
    Object.entries(porConjunto).forEach(([set, list]) => {
      const ordenada = [...list].sort((a, b) => favOf(a) - favOf(b));   // pior em cima: é o que a devolutiva ataca
      const s = pptx.addSlide();
      titulo(s, t('qe_dimensions') + (set && set !== '—' ? ' · ' + set : ''), t('pptx_dim_sub'));
      s.addChart(pptx.ChartType.bar, [{
        name: t('qr_favorable'),
        labels: ordenada.map(d => d.name),
        values: ordenada.map(d => favOf(d)),
      }], {
        x: 0.5, y: 1.3, w: 9, h: 3.9, barDir: 'bar', barGapWidthPct: 40,
        chartColors: ordenada.map(d => SEM_COLOR[semOf(d)] || RGIS),
        valAxisMaxVal: 100, valAxisMajorUnit: 25,
        showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0"%"',
        catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, showLegend: false,
      });
    });
  }

  // ── Perguntas críticas ──
  const criticas = (result?.questions || [])
    .filter(q => favOf(q) != null)
    .sort((a, b) => favOf(a) - favOf(b))
    .slice(0, 8);
  if (criticas.length) {
    const s = pptx.addSlide();
    titulo(s, t('pptx_critical'), t('pptx_critical_sub'));
    s.addChart(pptx.ChartType.bar, [{
      name: t('qr_favorable'),
      labels: criticas.map(q => (q.externalId ? q.externalId + '. ' : '') + String(q.text).slice(0, 58)),
      values: criticas.map(q => favOf(q)),
    }], {
      x: 0.5, y: 1.3, w: 9, h: 3.9, barDir: 'bar', barGapWidthPct: 40,
      chartColors: criticas.map(q => SEM_COLOR[semOf(q)] || RGIS),
      valAxisMaxVal: 100, valAxisMajorUnit: 25,
      showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0"%"',
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 10, showLegend: false,
    });
  }

  // ── Recortes ──
  const segs = result?.segments || {};
  [['modalidade', result?.segmentation ? t('rd_seg_modalidade') : null],
   ['distrito', t('rd_seg_distrito')],
   ['regional', t('rd_seg_regional')],
   ['departamento', t('rd_seg_departamento')]]
    .filter(([k, label]) => label && (segs[k] || []).filter(x => favOf(x) != null).length > 1)
    .forEach(([k, label]) => {
      const list = (segs[k] || []).filter(x => favOf(x) != null).sort((a, b) => favOf(a) - favOf(b)).slice(0, 12);
      const s = pptx.addSlide();
      titulo(s, t('rd_segments') + ' · ' + label, t('pptx_seg_sub'));
      s.addChart(pptx.ChartType.bar, [{
        name: t('qr_favorable'),
        labels: list.map(x => `${x.label} (n=${x.responses})`),
        values: list.map(favOf),
      }], {
        x: 0.5, y: 1.3, w: 9, h: 3.9, barDir: 'bar', barGapWidthPct: 40,
        chartColors: list.map(x => SEM_COLOR[semOf(x)] || RGIS),
        valAxisMaxVal: 100, valAxisMajorUnit: 25,
        showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0"%"',
        catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, showLegend: false,
      });
    });

  // ── Tabela das dimensões, para quem quer o número exato ──
  if (dims.length) {
    const s = pptx.addSlide();
    titulo(s, t('qe_dimensions'), t('pptx_table_sub'));
    const head = [t('qe_dimensions'), t('dm_set'), Cap(t('qr_favorable')), Cap(t('qr_unfavorable')), t('qr_semaforo')]
      .map(x => ({ text: x, options: { bold: true, color: 'FFFFFF', fill: { color: RGIS } } }));
    const body = [...dims].sort((a, b) => favOf(a) - favOf(b)).map(d => ([
      String(d.name), String(d.set || '—'),
      favOf(d) + '%', d.favorability.unfavorablePct + '%',
      { text: semLabel(semOf(d)), options: { color: SEM_COLOR[semOf(d)] || CINZA, bold: true } },
    ]));
    s.addTable([head, ...body], {
      x: 0.5, y: 1.3, w: 9, fontSize: 10, border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      colW: [3.6, 2.2, 1.1, 1.3, 0.8], rowH: 0.26, valign: 'middle',
    });
  }

  await pptx.writeFile({ fileName: `apresentacao-${slug(survey?.name, 'pesquisa')}.pptx` });
}
