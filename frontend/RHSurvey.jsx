import { useState, useEffect } from "react";
import api from "./src/api.js";
import {
  LayoutDashboard, ClipboardList, Users, BarChart3, Settings, Plus, Search,
  Bell, TrendingUp, CheckCircle, Clock, Send, Sparkles, Download, Eye, Edit,
  Trash2, X, Loader2, Target, Award, Mail, Link2, ChevronDown, ArrowUpRight,
  UserCheck, Building2, MessageSquare, ChevronRight, Shield, Lock, AlertTriangle,
  FileText, Key, Activity, EyeOff, Database, RefreshCw, Info,
  FileCheck, Zap, MessageCircle, BarChart2, Star, LogOut
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar
} from "recharts";
import * as XLSX from "xlsx";

// ─── CSV EXPORT HELPER ─────────────────────────────────────────────────────────
function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = (v === null || v === undefined) ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\uFEFF" + rows.map(r => r.map(esc).join(",")).join("\r\n"); // BOM p/ acentos no Excel
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── IMPORT DE PERGUNTAS (Excel/CSV) ────────────────────────────────────────────
function mapTipoToType(raw) {
  const t = (raw == null ? "" : String(raw)).trim().toLowerCase();
  if (!t) return { type: "text", unknown: false };
  if (t.includes("nps")) return { type: "nps", unknown: false };
  if (t.includes("escala") || t.includes("likert")) return { type: "scale", unknown: false };
  if (t.includes("estrela") || t.includes("nota") || t === "rating") return { type: "rating", unknown: false };
  if (t.includes("sim") || t.includes("não") || t.includes("nao") || t.includes("boolean") || t.includes("yesno")) return { type: "yesno", unknown: false };
  if (t.includes("múlt") || t.includes("mult") || t.includes("escolha") || t.includes("checkbox") || t.includes("seleç") || t.includes("selec")) return { type: "multiple", unknown: false };
  if (t.includes("text") || t.includes("aberta") || t.includes("disserta") || t.includes("livre") || t.includes("coment")) return { type: "text", unknown: false };
  return { type: "text", unknown: true };
}
function detectDelimiter(line) {
  const counts = { ",": 0, ";": 0, "\t": 0 }; let inQ = false;
  for (const c of line) { if (c === '"') inQ = !inQ; else if (!inQ && counts[c] !== undefined) counts[c]++; }
  let best = ",", bestN = -1;
  for (const d of [",", ";", "\t"]) if (counts[d] > bestN) { best = d; bestN = counts[d]; }
  return best;
}
function parseCSVText(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim() !== "") || "";
  const delim = detectDelimiter(firstLine);
  const rows = []; let row = [], field = "", i = 0, inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === delim) { row.push(field); field = ""; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return { rows: rows.filter(r => r.some(c => String(c).trim() !== "")), delim };
}
function rowsToQuestions(rows, delim) {
  if (!rows || rows.length === 0) return { questions: [], skipped: 0, unknown: 0 };
  const norm = s => (s == null ? "" : String(s)).trim().toLowerCase();
  const header = rows[0].map(norm);
  const looksHeader = header.some(h => h.includes("pergunta") || h.includes("tipo") || h.startsWith("op") || h.includes("texto") || h.includes("question"));
  let pIdx = 0, tIdx = 1, oIdx = 2, start = 0;
  if (looksHeader) {
    start = 1;
    const find = (keys, def) => { const idx = header.findIndex(h => keys.some(k => h.includes(k))); return idx >= 0 ? idx : def; };
    pIdx = find(["pergunta", "texto", "question"], 0);
    tIdx = find(["tipo", "type"], 1);
    oIdx = find(["opç", "opc", "op", "alternativa", "escolha"], 2);
  }
  const out = []; let skipped = 0, unknown = 0;
  for (let r = start; r < rows.length; r++) {
    const cols = rows[r] || [];
    const text = (cols[pIdx] == null ? "" : String(cols[pIdx])).trim();
    if (!text) { skipped++; continue; }
    const mapped = mapTipoToType(cols[tIdx]);
    if (mapped.unknown) unknown++;
    let options;
    if (mapped.type === "scale" || mapped.type === "multiple") {
      const rawOpts = cols[oIdx] == null ? "" : String(cols[oIdx]);
      const sep = (delim !== ";" && rawOpts.includes(";")) ? ";" : (rawOpts.includes("|") ? "|" : (rawOpts.includes(";") ? ";" : ","));
      const arr = rawOpts.split(sep).map(o => o.trim()).filter(Boolean);
      if (arr.length) options = arr;
    }
    out.push({ id: Date.now() + r, text, type: mapped.type, ...(options ? { options } : {}) });
  }
  return { questions: out, skipped, unknown };
}

// ─── MOCK DATA ─────────────────────────────────────────────────────────────────
const MOCK_SURVEYS = [
  { id:1, name:"Avaliação de Gestores Q2 2025",  type:"gestores",     status:"ativo",    responses:47,  total:60,  created:"10/05/2025", category:"360°",    nps:72, anonymous:true  },
  { id:2, name:"Satisfação de Fornecedores",      type:"fornecedores", status:"ativo",    responses:23,  total:35,  created:"15/05/2025", category:"NPS",     nps:65, anonymous:false },
  { id:3, name:"Clima Organizacional",            type:"subordinados", status:"encerrado",responses:120, total:120, created:"01/04/2025", category:"Clima",   nps:81, anonymous:true  },
  { id:4, name:"Avaliação 360° Liderança",        type:"gestores",     status:"rascunho", responses:0,   total:0,   created:"20/05/2025", category:"360°",    nps:0,  anonymous:true  },
  { id:5, name:"Feedback Subordinados TI",        type:"subordinados", status:"ativo",    responses:12,  total:25,  created:"18/05/2025", category:"Feedback",nps:58, anonymous:true  },
];

const MOCK_RESPONDENTS = [
  { id:1, name:"Carlos Silva",       email:"carlos@empresa.com",  group:"gestores",     department:"Vendas",    status:"respondeu", role:"Gerente",     consent:true  },
  { id:2, name:"Ana Rodrigues",      email:"ana@empresa.com",     group:"gestores",     department:"TI",        status:"pendente",  role:"Diretora",    consent:true  },
  { id:3, name:"Fornecedor ABC",     email:"contato@abc.com",     group:"fornecedores", department:"Logística", status:"respondeu", role:"Parceiro",    consent:true  },
  { id:4, name:"João Pereira",       email:"joao@empresa.com",    group:"subordinados", department:"Financeiro",status:"pendente",  role:"Analista",    consent:false },
  { id:5, name:"Maria Santos",       email:"maria@empresa.com",   group:"subordinados", department:"RH",        status:"respondeu", role:"Coordenadora",consent:true  },
  { id:6, name:"Fornecedor XYZ",     email:"xyz@tech.com",        group:"fornecedores", department:"Tecnologia",status:"pendente",  role:"Parceiro",    consent:true  },
  { id:7, name:"Pedro Alves",        email:"pedro@empresa.com",   group:"gestores",     department:"Marketing", status:"respondeu", role:"Gerente",     consent:true  },
  { id:8, name:"Lucia Ferreira",     email:"lucia@empresa.com",   group:"subordinados", department:"Operações", status:"pendente",  role:"Técnica",     consent:false },
];

const RESPONSE_DATA    = [{ mes:"Jan",respostas:45},{ mes:"Fev",respostas:62},{ mes:"Mar",respostas:78},{ mes:"Abr",respostas:95},{ mes:"Mai",respostas:110},{ mes:"Jun",respostas:87}];
const SATISFACTION_DATA= [{ name:"Ótimo",value:45,color:"#10B981"},{ name:"Bom",value:30,color:"#5B21B6"},{ name:"Regular",value:18,color:"#F59E0B"},{ name:"Ruim",value:7,color:"#EF4444"}];
const RADAR_DATA       = [{ subject:"Liderança",score:85},{ subject:"Comunicação",score:72},{ subject:"Inovação",score:90},{ subject:"Equipe",score:78},{ subject:"Resultados",score:88},{ subject:"Desenvolv.",score:65}];
const NPS_HISTORY      = [{ mes:"Jan",nps:55},{ mes:"Fev",nps:62},{ mes:"Mar",nps:58},{ mes:"Abr",nps:71},{ mes:"Mai",nps:75},{ mes:"Jun",nps:72}];

const QUESTION_TYPES = [
  { id:"nps",      label:"NPS (0–10)",      icon:"📊", desc:"Probabilidade de recomendar" },
  { id:"scale",    label:"Escala Likert",   icon:"⭐", desc:"Avaliação 1 a 5"             },
  { id:"multiple", label:"Múltipla Escolha",icon:"☑️", desc:"Uma ou mais opções"          },
  { id:"text",     label:"Texto Aberto",    icon:"✏️", desc:"Resposta livre"               },
  { id:"rating",   label:"Estrelas",        icon:"🌟", desc:"Avaliação visual 1–5"         },
  { id:"yesno",    label:"Sim / Não",       icon:"✅", desc:"Escolha binária"              },
];



const MOCK_USERS = [
  { id:1, name:"Admin RH",        email:"admin@empresa.com",    role:"admin",   lastLogin:"Hoje 08:41",  active:true  },
  { id:2, name:"Fernanda Lima",   email:"fernanda@empresa.com", role:"manager", lastLogin:"Hoje 10:22",  active:true  },
  { id:3, name:"Bruno Carvalho",  email:"bruno@empresa.com",    role:"viewer",  lastLogin:"Ontem 16:00", active:true  },
  { id:4, name:"Rafael Moreira",  email:"rafael@empresa.com",   role:"manager", lastLogin:"3 dias atrás",active:false },
];

const MOCK_TEMPLATES = [
  { id:1, name:"Avaliação 360° Completa",   category:"360°",        questions:18, uses:142, rating:4.9, tags:["Liderança","Desempenho","LGPD"] },
  { id:2, name:"NPS Interno Rápido",        category:"NPS",         questions:3,  uses:89,  rating:4.7, tags:["NPS","Pulso","Quick"]           },
  { id:3, name:"Clima Organizacional",      category:"Clima",       questions:25, uses:67,  rating:4.8, tags:["Engajamento","Cultura"]         },
  { id:4, name:"Avaliação de Fornecedor",   category:"Fornecedores",questions:12, uses:54,  rating:4.6, tags:["B2B","Qualidade"]               },
  { id:5, name:"Onboarding — 30 dias",      category:"Integração",  questions:8,  uses:38,  rating:4.5, tags:["Onboarding","Novo Colaborador"] },
  { id:6, name:"Feedback de Desligamento",  category:"Turnover",    questions:15, uses:31,  rating:4.8, tags:["Exit Interview","Turnover"]     },
  { id:7, name:"Avaliação de Treinamento",  category:"T&D",         questions:10, uses:28,  rating:4.4, tags:["Treinamento","Capacitação"]     },
  { id:8, name:"Pesquisa Pulso Semanal",    category:"Pulso",       questions:5,  uses:125, rating:4.9, tags:["Ágil","Semanal","Quick"]        },
];

const MOCK_NOTIFICATIONS = [
  { id:1, type:"response", text:"Ana Rodrigues respondeu a pesquisa Gestores Q2",    time:"5 min",      read:false },
  { id:2, type:"alert",    text:"2 respondentes sem consentimento LGPD registrado",  time:"1h",         read:false },
  { id:3, type:"ai",       text:"Insights gerados para Clima Organizacional",        time:"3h",         read:true  },
  { id:4, type:"deadline", text:"Pesquisa Fornecedores encerra em 5 dias",           time:"Hoje 09:00", read:false },
  { id:5, type:"success",  text:"Exportação de relatório PDF concluída",             time:"Hoje 11:30", read:true  },
  { id:6, type:"security", text:"Tentativa de login bloqueada — IP desconhecido",   time:"Hoje 12:00", read:false },
];

const COMP_BAR_DATA = [
  { grupo:"Gestores",     score:82 },
  { grupo:"Fornecedores", score:68 },
  { grupo:"Subordinados", score:75 },
];

const TREND_DATA = [
  { mes:"Jan",gestores:74,subordinados:70,fornecedores:60 },
  { mes:"Fev",gestores:76,subordinados:72,fornecedores:62 },
  { mes:"Mar",gestores:78,subordinados:71,fornecedores:63 },
  { mes:"Abr",gestores:80,subordinados:74,fornecedores:65 },
  { mes:"Mai",gestores:82,subordinados:75,fornecedores:68 },
  { mes:"Jun",gestores:84,subordinados:76,fornecedores:70 },
];

const SAMPLE_QUESTIONS = [
  { id:1, type:"nps",      text:"De 0 a 10, qual a probabilidade de você recomendar este gestor a um colega?",             opts:[] },
  { id:2, type:"scale",    text:"Como você avalia a capacidade de comunicação deste gestor?",                               opts:["Muito ruim","Ruim","Regular","Bom","Excelente"] },
  { id:3, type:"rating",   text:"Avalie a liderança e motivação da equipe promovidas por este gestor.",                    opts:[] },
  { id:4, type:"multiple", text:"Quais competências este gestor demonstra de forma consistente?",                           opts:["Comunicação clara","Tomada de decisão","Desenvolv. de pessoas","Foco em resultados","Inovação","Empatia"] },
  { id:5, type:"text",     text:"Descreva uma situação em que este gestor demonstrou liderança exemplar.",                  opts:[] },
  { id:6, type:"yesno",    text:"Você se sente apoiado e ouvido por este gestor em suas demandas?",                       opts:[] },
];

const MOCK_CAMPAIGNS = [
  { id:1, name:"Gestores Q2 — E-mail",        channel:"email",    status:"enviado",  sent:60, opened:47, responded:47, survey:"Avaliação de Gestores Q2 2025", date:"10/05/2025" },
  { id:2, name:"NPS Fornecedores — WhatsApp", channel:"whatsapp", status:"enviado",  sent:35, opened:28, responded:23, survey:"Satisfação de Fornecedores",    date:"15/05/2025" },
  { id:3, name:"Feedback TI — E-mail",        channel:"email",    status:"agendado", sent:0,  opened:0,  responded:0,  survey:"Feedback Subordinados TI",      date:"25/05/2025" },
];

const AUDIT_LOG = [
  { id:1, user:"admin@empresa.com", action:"Login efetuado",               time:"Hoje 08:41", type:"auth"   },
  { id:2, user:"admin@empresa.com", action:"Pesquisa criada: Gestores Q2", time:"Hoje 09:12", type:"create" },
  { id:3, user:"carlos@empresa.com",action:"Respondeu pesquisa #1",         time:"Hoje 10:05", type:"data"   },
  { id:4, user:"admin@empresa.com", action:"Exportação de relatório PDF",   time:"Hoje 11:30", type:"export" },
  { id:5, user:"ana@empresa.com",   action:"Tentativa de acesso negada",    time:"Hoje 12:00", type:"alert"  },
];

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────
const GRAD        = "linear-gradient(135deg,#5B21B6,#7C3AED)";
const GRAD_GREEN  = "linear-gradient(135deg,#059669,#10B981)";
const GRAD_AMBER  = "linear-gradient(135deg,#B45309,#F59E0B)";

const STATUS_CFG = {
  ativo:     { label:"Ativo",     bg:"bg-green-100", text:"text-green-700", dot:"bg-green-500"  },
  encerrado: { label:"Encerrado", bg:"bg-slate-100", text:"text-slate-600", dot:"bg-slate-400"  },
  rascunho:  { label:"Rascunho",  bg:"bg-amber-100", text:"text-amber-700", dot:"bg-amber-500"  },
  respondeu: { label:"Respondeu", bg:"bg-green-100", text:"text-green-700", dot:"bg-green-500"  },
  pendente:  { label:"Pendente",  bg:"bg-amber-100", text:"text-amber-700", dot:"bg-amber-400"  },
};

const GROUP_CFG = {
  gestores:     { label:"Gestores",     color:"bg-purple-100 text-purple-700", Icon:UserCheck  },
  fornecedores: { label:"Fornecedores", color:"bg-blue-100 text-blue-700",     Icon:Building2  },
  subordinados: { label:"Subordinados", color:"bg-teal-100 text-teal-700",     Icon:Users      },
};

const TYPE_LABELS = { nps:"NPS", scale:"Escala", multiple:"Múltipla", text:"Texto", rating:"Estrelas", yesno:"Sim/Não" };
const TYPE_COLORS = {
  nps:"bg-purple-100 text-purple-700", scale:"bg-blue-100 text-blue-700",
  multiple:"bg-green-100 text-green-700", text:"bg-orange-100 text-orange-700",
  rating:"bg-amber-100 text-amber-700", yesno:"bg-teal-100 text-teal-700",
};

// ─── ATOMS ─────────────────────────────────────────────────────────────────────
function Badge({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.rascunho;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{c.label}
    </span>
  );
}

function GroupBadge({ group }) {
  const c = GROUP_CFG[group] || GROUP_CFG.subordinados;
  const Icon = c.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${c.color}`}>
      <Icon size={11} />{c.label}
    </span>
  );
}

function KpiCard({ title, value, subtitle, icon: Icon, colorClass, trend }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorClass}`}>
          <Icon size={20} className="text-white" />
        </div>
        {trend && (
          <span className="text-xs font-medium text-green-600 flex items-center gap-0.5 bg-green-50 px-2 py-1 rounded-full">
            <ArrowUpRight size={10} />{trend}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-slate-800 mb-0.5">{value}</div>
      <div className="text-sm text-slate-500">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function LGPDBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
      <Shield size={10} />LGPD
    </span>
  );
}

// ─── LGPD CONSENT BANNER ──────────────────────────────────────────────────────
function LGPDBanner({ onAccept }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl border border-slate-200 p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
          <Shield size={20} style={{ color: "#5B21B6" }} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-slate-800 text-sm mb-1">Privacidade & LGPD — Lei Geral de Proteção de Dados</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Esta plataforma coleta e processa dados pessoais em conformidade com a <strong>Lei nº 13.709/2018 (LGPD)</strong>. 
            As informações coletadas são utilizadas exclusivamente para fins de avaliação organizacional interna. 
            Você tem direito de acesso, correção, portabilidade e exclusão dos seus dados a qualquer momento. 
            Ao continuar, você consente com nossa <span className="text-purple-600 cursor-pointer hover:underline">Política de Privacidade</span>.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={onAccept} className="px-4 py-2 text-xs border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors">
            Recusar opcionais
          </button>
          <button onClick={onAccept} className="px-4 py-2 text-xs text-white rounded-xl hover:opacity-90 transition-opacity" style={{ background: GRAD }}>
            Aceitar e continuar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ page, setPage }) {
  const [menuOpen, setMenuOpen] = useState(false);
  let me = {};
  try { me = JSON.parse(localStorage.getItem("rh_user") || "{}"); } catch {}
  const meName     = me.name || "Usuário";
  const meEmail    = me.email || "";
  const meInitials = (me.name || "U").trim().split(/\s+/).map(w => w[0]).slice(0,2).join("").toUpperCase() || "U";
  const handleLogout = () => {
    try { localStorage.removeItem("rh_token"); localStorage.removeItem("rh_user"); } catch {}
    window.location.reload();
  };
  const nav = [
    { id:"dashboard",     label:"Dashboard",      Icon:LayoutDashboard },
    { id:"surveys",       label:"Pesquisas",       Icon:ClipboardList   },
    { id:"respondents",   label:"Respondentes",    Icon:Users           },
    { id:"evaluation360", label:"Avaliação 360°",  Icon:Target          },
    { id:"results",       label:"Resultados",      Icon:BarChart3       },
    { id:"formulario",    label:"Formulário",       Icon:FileText        },
    { id:"templates",     label:"Templates",        Icon:FileCheck       },
    { id:"relatorios",    label:"Relatórios Avanç.", Icon:BarChart2       },
    { id:"equipe",        label:"Equipe & Acesso",  Icon:UserCheck       },
    { id:"notificacoes",  label:"Notificações",      Icon:Bell            },
    { id:"distribuicao",  label:"Distribuição",     Icon:Send            },
    { id:"insights",      label:"Insights com IA",  Icon:Sparkles        },
    { id:"lgpd",          label:"LGPD & Privac.",   Icon:Shield          },
    { id:"security",      label:"Segurança",         Icon:Lock            },
    { id:"settings",      label:"Configurações",    Icon:Settings        },
  ];
  return (
    <div style={{ width:240, minWidth:240 }} className="bg-white border-r border-slate-100 flex flex-col h-screen">
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ background:GRAD }}>RH</div>
          <div>
            <div className="font-bold text-slate-800 text-sm">RH Survey</div>
            <div className="text-xs text-slate-400 flex items-center gap-1"><Shield size={9} className="text-green-500" />LGPD Compliant</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ id, label, Icon }) => {
          const active = page === id;
          const isNew  = id === "evaluation360";
          const isSec  = id === "lgpd" || id === "security";
          return (
            <button key={id} onClick={() => setPage(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? "text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"}`}
              style={active ? { background: isSec ? GRAD_GREEN : GRAD } : {}}>
              <Icon size={17} />{label}
              {isNew && !active && <span className="ml-auto text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-semibold">Novo</span>}
            </button>
          );
        })}
      </nav>
      <div className="px-3 py-3 border-t border-slate-100 space-y-2">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-green-50 rounded-xl border border-green-100">
          <Shield size={12} className="text-green-600" />
          <span className="text-xs text-green-700 font-medium">Ambiente seguro · TLS 1.3</span>
        </div>
        <div className="relative">
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20">
                <button onClick={() => { setMenuOpen(false); setPage("settings"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Settings size={15} className="text-slate-400" />Configurações
                </button>
                <button onClick={() => { setMenuOpen(false); setPage("settings"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left border-t border-slate-50">
                  <Key size={15} className="text-slate-400" />Trocar senha
                </button>
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 text-left border-t border-slate-50">
                  <LogOut size={15} />Sair
                </button>
              </div>
            </>
          )}
          <div onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-50 cursor-pointer">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background:GRAD }}>{meInitials}</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-700 truncate">{meName}</div>
              <div className="text-xs text-slate-400 truncate">{meEmail}</div>
            </div>
            <ChevronDown size={13} className={`text-slate-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TOPBAR ────────────────────────────────────────────────────────────────────
function TopBar({ title, unreadCount, onBell }) {
  return (
    <div className="bg-white border-b border-slate-100 px-8 py-3.5 flex items-center justify-between sticky top-0 z-10">
      <div className="text-sm text-slate-400">
        RH Survey <span className="mx-1 text-slate-300">/</span>
        <span className="text-slate-700 font-medium">{title}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-100 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-green-700 font-medium">Sistema seguro</span>
        </div>
        <button onClick={onBell} className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          <Bell size={17} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center leading-none">{unreadCount}</span>
          )}
        </button>
        <div className="w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ background:GRAD }}>RH</div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({ setPage }) {
  const [data,    setData]    = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [resp,    setResp]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [dash, surv, people] = await Promise.all([
          api.results.dashboard(),
          api.surveys.list().catch(() => ({ surveys: [] })),
          api.respondents.list().catch(() => ({ respondents: [] })),
        ]);
        setData(dash);
        setSurveys(surv.surveys || []);
        setResp(people.respondents || []);
      } catch (e) {
        setError(e.message || "Não foi possível carregar o painel.");
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div className="p-8 flex items-center justify-center" style={{ minHeight:"60vh" }}>
      <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 size={18} className="animate-spin" />Carregando painel...</div>
    </div>
  );
  if (error) return (
    <div className="p-8">
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
        <AlertTriangle size={15} />{error}
      </div>
    </div>
  );

  const totalSurveys = data?.totalSurveys ?? 0;
  const active       = data?.active ?? 0;
  const totalResp    = data?.totalResponses ?? 0;
  const recent       = data?.recentSurveys || [];

  // LGPD — consentimentos reais
  const consentTotal = resp.length;
  const consentOk    = resp.filter(r => r.consent_given).length;
  const consentPct   = consentTotal ? Math.round((consentOk / consentTotal) * 100) : 0;
  const anonCount    = surveys.filter(s => s.anonymous).length;

  // Gráfico honesto 1: respostas por pesquisa (top 6 com respostas)
  const byResponses = [...surveys]
    .map(s => ({ name: (s.name || "").length > 16 ? s.name.slice(0,15) + "…" : (s.name || "—"), respostas: s.response_count || 0 }))
    .sort((a,b) => b.respostas - a.respostas)
    .slice(0, 6);

  // Gráfico honesto 2: pesquisas por status
  const statusColors = { ativo:"#10B981", encerrado:"#94A3B8", rascunho:"#F59E0B" };
  const statusLabels = { ativo:"Ativas", encerrado:"Encerradas", rascunho:"Rascunhos" };
  const byStatus = ["ativo","encerrado","rascunho"]
    .map(st => ({ name: statusLabels[st], value: surveys.filter(s => s.status === st).length, color: statusColors[st] }))
    .filter(d => d.value > 0);

  return (
    <div className="p-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-800">Bom dia, Equipe RH 👋</h1>
        <p className="text-slate-500 mt-1 text-sm">Visão geral das pesquisas, avaliações e conformidade LGPD.</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard title="Pesquisas Ativas"    value={String(active)}       subtitle={`${totalSurveys} no total`}        icon={ClipboardList} colorClass="bg-purple-500"  />
        <KpiCard title="Total de Respostas"  value={String(totalResp)}    subtitle="Avaliações concluídas"             icon={CheckCircle}   colorClass="bg-emerald-500" />
        <KpiCard title="Pesquisas Criadas"   value={String(totalSurveys)} subtitle="Em todos os status"                icon={TrendingUp}    colorClass="bg-blue-500"    />
        <KpiCard title="Respondentes"        value={String(consentTotal)} subtitle={`${consentOk} com consentimento`}  icon={Users}         colorClass="bg-amber-500"   />
      </div>

      {/* LGPD quick status — dados reais */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl p-4 border border-green-200 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0"><Shield size={18} className="text-green-600" /></div>
          <div>
            <div className="text-sm font-semibold text-slate-800">Consentimentos</div>
            <div className="text-xs text-slate-500 mt-0.5">{consentOk} de {consentTotal} coletados <span className="text-green-600 font-medium">({consentPct}%)</span></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-blue-200 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0"><Lock size={18} className="text-blue-600" /></div>
          <div>
            <div className="text-sm font-semibold text-slate-800">Dados Anonimizados</div>
            <div className="text-xs text-slate-500 mt-0.5">{anonCount} pesquisa(s) com anonimato</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-purple-200 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0"><Activity size={18} style={{ color:"#5B21B6" }} /></div>
          <div>
            <div className="text-sm font-semibold text-slate-800">Trilha de Auditoria</div>
            <div className="text-xs text-slate-500 mt-0.5">Ativa · registros LGPD</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5 mb-6">
        <div className="col-span-2 bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <h3 className="font-semibold text-slate-800 text-sm mb-1">Respostas por Pesquisa</h3>
          <p className="text-xs text-slate-400 mb-5">Avaliações concluídas em cada pesquisa</p>
          {byResponses.some(d => d.respostas > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={byResponses}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize:11, fill:"#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:11, fill:"#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius:10, border:"none", boxShadow:"0 4px 20px rgba(0,0,0,0.08)", fontSize:12 }} />
                <Bar dataKey="respostas" fill="#5B21B6" radius={[5,5,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center text-slate-400 text-sm" style={{ height:180 }}>Ainda não há respostas registradas.</div>
          )}
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <h3 className="font-semibold text-slate-800 text-sm mb-1">Pesquisas por Status</h3>
          <p className="text-xs text-slate-400 mb-3">Distribuição atual</p>
          {byStatus.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie data={byStatus} cx="50%" cy="50%" innerRadius={40} outerRadius={58} dataKey="value" stroke="none">
                    {byStatus.map((e,i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius:10, border:"none", boxShadow:"0 4px 20px rgba(0,0,0,0.08)", fontSize:12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-1">
                {byStatus.map((d,i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background:d.color }} />
                      <span className="text-slate-600">{d.name}</span>
                    </div>
                    <span className="font-semibold text-slate-700">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center text-slate-400 text-sm" style={{ height:130 }}>Sem pesquisas ainda.</div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-5">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-sm">Pesquisas Recentes</h3>
          <button onClick={() => setPage("surveys")} className="text-xs font-medium flex items-center gap-1 hover:opacity-80" style={{ color:"#5B21B6" }}>
            Ver todas <ChevronRight size={13} />
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">Nenhuma pesquisa criada ainda.</div>
        ) : recent.slice(0,4).map((s,i) => (
          <div key={s.id} className={`flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors ${i<Math.min(recent.length,4)-1?"border-b border-slate-50":""}`}>
            <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
              <ClipboardList size={14} style={{ color:"#5B21B6" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800 truncate">{s.name}</span>
                {s.anonymous ? <LGPDBadge /> : null}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{s.responses} resposta(s)</div>
            </div>
            <div className="flex items-center gap-2.5">
              <Badge status={s.status} /><GroupBadge group={s.target_group} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label:"Nova Pesquisa",         desc:"Crie um questionário",  Icon:Plus,    bg:"bg-purple-500",  target:"surveys"      },
          { label:"Gerenciar Respondentes",desc:"Adicione participantes",Icon:Users,   bg:"bg-blue-500",    target:"respondents"  },
          { label:"Ver Resultados",        desc:"Análise completa",      Icon:BarChart3,bg:"bg-emerald-500",target:"results"      },
        ].map(({ label,desc,Icon,bg,target },i) => (
          <button key={i} onClick={() => setPage(target)} className="flex items-center gap-3 bg-white border border-slate-100 rounded-2xl p-4 hover:shadow-md transition-all text-left group">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0`}>
              <Icon size={18} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">{label}</div>
              <div className="text-xs text-slate-400">{desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}


// ─── SURVEY LIST ───────────────────────────────────────────────────────────────
function SurveyList({ onCreateNew, onView }) {
  const [search,  setSearch]  = useState("");
  const [filter,  setFilter]  = useState("todos");
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [sv, rs] = await Promise.all([
          api.surveys.list(),
          api.respondents.list().catch(() => ({ respondents: [] })),
        ]);
        const audience = (rs.respondents || []).length;
        const mapped = (sv.surveys || []).map(s => ({
          id:         s.id,
          name:       s.name,
          type:       s.target_group || "subordinados",
          status:     s.status,
          responses:  s.response_count || 0,
          total:      audience || s.response_count || 0,
          created:    s.created_at ? new Date(s.created_at).toLocaleDateString("pt-BR") : "—",
          category:   s.category || "—",
          nps:        0,
          anonymous:  !!s.anonymous,
          token:      s.public_token || "",
        }));
        if (alive) { setSurveys(mapped); setLoading(false); }
      } catch (e) {
        if (alive) { setError(e.message || "Erro ao carregar pesquisas."); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, []);

  const filtered = surveys.filter(s => {
    const ms = s.name.toLowerCase().includes(search.toLowerCase());
    const mf = filter === "todos" || s.status === filter;
    return ms && mf;
  });

  const handleDelete = async (s) => {
    if (!window.confirm(`Excluir a pesquisa "${s.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.del(`/surveys/${s.id}`);
      setSurveys(prev => prev.filter(x => x.id !== s.id));
    } catch (e) {
      alert(e.message || "Erro ao excluir a pesquisa.");
    }
  };

  const [copiedId, setCopiedId] = useState(null);
  const handleCopyLink = async (s) => {
    if (!s.token) return;
    const url = `${window.location.origin}/r/${s.token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopiedId(s.id);
    setTimeout(() => setCopiedId(c => (c === s.id ? null : c)), 2000);
  };

  if (loading) return <div className="p-8 flex items-center justify-center text-slate-400 text-sm gap-2" style={{ minHeight:"60vh" }}><Loader2 size={18} className="animate-spin" />Carregando pesquisas...</div>;
  if (error)   return <div className="p-8"><div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2"><AlertTriangle size={15} />{error}</div></div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Pesquisas</h1>
          <p className="text-sm text-slate-500 mt-1">Gerencie questionários com controle de privacidade e LGPD.</p>
        </div>
        <button onClick={onCreateNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-medium hover:opacity-90" style={{ background:GRAD }}>
          <Plus size={15} />Nova Pesquisa
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-purple-400"
            placeholder="Buscar pesquisa..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {["todos","ativo","encerrado","rascunho"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${filter===f?"text-white":"bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}
            style={filter===f?{ background:GRAD }:{}}>
            {f==="todos"?"Todos":f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {filtered.map(s => {
          const pct = s.total>0 ? Math.round((s.responses/s.total)*100) : 0;
          return (
            <div key={s.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <ClipboardList size={18} style={{ color:"#5B21B6" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-800">{s.name}</h3>
                        {s.anonymous && <LGPDBadge />}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge status={s.status} /><GroupBadge group={s.type} />
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{s.category}</span>
                        {s.anonymous && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full flex items-center gap-1"><EyeOff size={10} />Anônima</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => onView && onView(s)} title="Ver resultados"
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><Eye size={14} /></button>
                      <button disabled title="Edição de pesquisa — em desenvolvimento"
                        className="p-2 rounded-lg text-slate-300 cursor-not-allowed"><Edit size={14} /></button>
                      <button onClick={() => handleDelete(s)} title="Excluir pesquisa"
                        className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 mt-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                        <span>Progresso</span>
                        <span className="font-medium text-slate-700">{s.responses}/{s.total}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width:`${pct}%`, background:GRAD }} />
                      </div>
                    </div>
                    {s.nps>0 && (
                      <div className="text-center">
                        <div className="text-lg font-bold" style={{ color:"#5B21B6" }}>{s.nps}</div>
                        <div className="text-xs text-slate-400">NPS</div>
                      </div>
                    )}
                    <div className="text-center">
                      <div className="text-lg font-bold text-slate-700">{pct}%</div>
                      <div className="text-xs text-slate-400">Conclusão</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-4 pt-3.5 border-t border-slate-50">
                    <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={11} />{s.created}</span>
                    <div className="flex gap-3 ml-auto">
                      <button disabled title="Envio por e-mail — em desenvolvimento" className="flex items-center gap-1 text-xs text-slate-300 cursor-not-allowed font-medium"><Mail size={11} />E-mail</button>
                      <button onClick={() => handleCopyLink(s)} disabled={!s.token || s.status!=="ativo"}
                        title={s.status!=="ativo" ? "Publique a pesquisa para gerar o link" : "Copiar link público de resposta"}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-purple-600 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                        {copiedId===s.id ? <><CheckCircle size={11} />Copiado!</> : <><Link2 size={11} />Copiar link</>}
                      </button>
                      <button disabled title="Envio por WhatsApp — em desenvolvimento" className="flex items-center gap-1 text-xs text-slate-300 cursor-not-allowed font-medium"><Send size={11} />WhatsApp</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SURVEY BUILDER ────────────────────────────────────────────────────────────
function SurveyBuilder({ onBack }) {
  const [tab,       setTab]       = useState("builder");
  const [surveyName,setSurveyName]= useState("");
  const [questions, setQuestions] = useState([]);
  const [aiContext, setAiContext]  = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQs,      setAiQs]      = useState([]);
  const [selType,   setSelType]   = useState("nps");
  const [newQ,      setNewQ]      = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [lgpdOk,    setLgpdOk]   = useState(false);
  const [targetGroup, setTargetGroup] = useState("Gestores");
  const [category,    setCategory]    = useState("Avaliação 360°");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState(null);
  const [importErr,   setImportErr]   = useState("");
  const [importInfo,  setImportInfo]  = useState("");

  const GROUP_MAP = { "Gestores":"gestores", "Fornecedores":"fornecedores", "Subordinados":"subordinados", "Todos":"todos" };

  const handleSubmit = async (publishNow) => {
    setError(null);
    if (!surveyName.trim())     { setError("Dê um nome à pesquisa."); return; }
    if (questions.length === 0) { setError("Adicione pelo menos uma pergunta antes de salvar."); return; }
    if (publishNow && !lgpdOk)  { setError("Confirme a conformidade LGPD antes de publicar."); return; }
    setSaving(true);
    try {
      const result = await api.surveys.create({
        name: surveyName.trim(),
        category,
        targetGroup: GROUP_MAP[targetGroup] || "todos",
        anonymous,
        questions: questions.map(q => ({ type: q.type, text: q.text, options: q.options })),
        lgpdBasis: "consentimento",
      });
      const id = result && result.survey && result.survey.id;
      if (publishNow && id) await api.post(`/surveys/${id}/publish`);
      onBack();
    } catch (e) {
      setError((e && e.message) || "Erro ao salvar a pesquisa.");
      setSaving(false);
    }
  };

  const addQ = () => {
    if (!newQ.trim()) return;
    setQuestions(p => [...p,{ id:Date.now(), text:newQ, type:selType }]);
    setNewQ("");
  };

  const generateAI = async () => {
    if (!aiContext.trim()) return;
    setAiLoading(true); setAiQs([]);
    try {
      const data = await api.surveys.generateAI(aiContext, 6);
      setAiQs(data.questions || []);
    } catch (e) {
      setAiQs([{ text:(e && e.message) || "Erro ao gerar. Verifique a conexão e tente novamente.", type:"text" }]);
    }
    setAiLoading(false);
  };

  const onImportFile = async (e) => {
    setImportErr(""); setImportInfo("");
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = ""; // permite reimportar o mesmo arquivo
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    try {
      let result;
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
        result = rowsToQuestions(rows, ",");
      } else if (name.endsWith(".json")) {
        const data = JSON.parse(await file.text());
        const arr = Array.isArray(data) ? data : (data.questions || data.perguntas || []);
        const qs = []; let skipped = 0, unknown = 0;
        arr.forEach((q, i) => {
          const t = (q.text ?? q.pergunta ?? q.texto ?? "").toString().trim();
          if (!t) { skipped++; return; }
          const m = mapTipoToType(q.type ?? q.tipo ?? "");
          if (m.unknown) unknown++;
          let options;
          if (m.type === "scale" || m.type === "multiple") {
            const raw = q.options ?? q.opcoes ?? q["opções"] ?? q.alternativas;
            if (Array.isArray(raw)) options = raw.map(o => String(o).trim()).filter(Boolean);
            else if (typeof raw === "string" && raw.trim()) options = raw.split(/[;|,]/).map(o => o.trim()).filter(Boolean);
          }
          qs.push({ id: Date.now() + i, text: t, type: m.type, ...(options && options.length ? { options } : {}) });
        });
        result = { questions: qs, skipped, unknown };
      } else if (name.endsWith(".csv") || name.endsWith(".txt")) {
        const { rows, delim } = parseCSVText(await file.text());
        result = rowsToQuestions(rows, delim);
      } else {
        setImportErr("Formato não suportado. Use um arquivo .xlsx, .csv ou .json.");
        return;
      }
      if (!result.questions.length) {
        setImportErr("Nenhuma pergunta encontrada. Verifique se há uma coluna “Pergunta” preenchida.");
        return;
      }
      setQuestions(p => [...p, ...result.questions]);
      const bits = [`${result.questions.length} pergunta(s) importada(s)`];
      if (result.skipped) bits.push(`${result.skipped} linha(s) vazia(s) ignorada(s)`);
      if (result.unknown) bits.push(`${result.unknown} com tipo não reconhecido → tratada(s) como texto`);
      setImportInfo(bits.join(" · "));
    } catch (err) {
      setImportErr("Não foi possível ler o arquivo. Confira se é um Excel/CSV válido." + (err && err.message ? ` (${err.message})` : ""));
    }
  };

  const tabs = [
    { id:"builder", label:"✏️ Criar Perguntas" },
    { id:"ai",      label:"✨ Gerar com IA"    },
    { id:"import",  label:"📥 Importar"        },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-7">
        <button onClick={onBack} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl">
          <ChevronRight size={17} className="rotate-180" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Nova Pesquisa</h1>
          <p className="text-sm text-slate-500 mt-0.5">Configure, adicione perguntas e defina proteções de privacidade.</p>
        </div>
        <div className="ml-auto flex gap-3">
          <button onClick={() => handleSubmit(false)} disabled={saving}
            className="px-4 py-2 text-sm border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2">
            {saving ? <><Loader2 size={14} className="animate-spin" />Salvando...</> : "Salvar Rascunho"}
          </button>
          <button onClick={() => handleSubmit(true)} disabled={saving || !lgpdOk} title={!lgpdOk?"Confirme os termos LGPD antes de publicar":""}
            className="px-4 py-2 text-sm text-white rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-2" style={{ background:GRAD }}>
            {saving ? <><Loader2 size={14} className="animate-spin" />Publicando...</> : <><Send size={14} />Publicar Pesquisa</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 flex items-center gap-2 text-sm">
          <AlertTriangle size={15} className="flex-shrink-0" />{error}
        </div>
      )}

      {/* Basic Info */}
      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm mb-5">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="col-span-2">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-2">Nome da Pesquisa *</label>
            <input className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-purple-400 text-sm"
              placeholder="Ex: Avaliação de Gestores Q3 2025" value={surveyName} onChange={e => setSurveyName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Público-Alvo</label>
            <select value={targetGroup} onChange={e => setTargetGroup(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none bg-white">
              {["Gestores","Fornecedores","Subordinados","Todos"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Categoria</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none bg-white">
              {["Avaliação 360°","NPS","Clima Organizacional","Feedback"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {/* LGPD Panel */}
        <div className="border border-green-200 rounded-xl p-4 bg-green-50">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={15} className="text-green-600" />
            <span className="text-sm font-semibold text-green-800">Configurações de Privacidade (LGPD)</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <div onClick={() => setAnonymous(!anonymous)}
                className={`w-10 h-5 rounded-full relative transition-colors ${anonymous?"bg-green-500":"bg-slate-300"}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${anonymous?"translate-x-5":"translate-x-0.5"}`} />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-700">Respostas Anônimas</div>
                <div className="text-xs text-slate-500">Não vincula resposta ao respondente</div>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer" onClick={() => setLgpdOk(!lgpdOk)}>
              <div className={`w-4 h-4 mt-0.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${lgpdOk?"border-green-500 bg-green-500":"border-slate-300"}`}>
                {lgpdOk && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <div>
                <div className="text-xs font-medium text-slate-700">Confirmo conformidade LGPD *</div>
                <div className="text-xs text-slate-500">Dados coletados com base legal e finalidade definida</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${tab===t.id?"text-white":"bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            style={tab===t.id?{ background:GRAD }:{}}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns:"2fr 3fr" }}>
        {/* LEFT */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          {tab==="builder" && (
            <>
              <h3 className="font-semibold text-slate-800 text-sm mb-4">Tipo de Pergunta</h3>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {QUESTION_TYPES.map(qt => (
                  <button key={qt.id} onClick={() => setSelType(qt.id)}
                    className={`p-3 rounded-xl text-left border transition-all ${selType===qt.id?"border-purple-400 bg-purple-50":"border-slate-200 hover:bg-slate-50"}`}>
                    <div className="text-base mb-0.5">{qt.icon}</div>
                    <div className="text-xs font-semibold text-slate-700 leading-tight">{qt.label}</div>
                    <div className="text-xs text-slate-400 mt-0.5 leading-tight">{qt.desc}</div>
                  </button>
                ))}
              </div>
              <textarea className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-purple-400 resize-none"
                placeholder="Digite o texto da pergunta..." rows={3} value={newQ} onChange={e => setNewQ(e.target.value)} />
              <button onClick={addQ} disabled={!newQ.trim()}
                className="w-full mt-3 py-2.5 text-sm font-medium text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                style={{ background:GRAD }}>
                + Adicionar Pergunta
              </button>
            </>
          )}

          {tab==="ai" && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} style={{ color:"#5B21B6" }} />
                <h3 className="font-semibold text-slate-800 text-sm">Gerador com IA</h3>
              </div>
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl mb-3">
                <Info size={13} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700 leading-relaxed">A IA gera perguntas respeitando boas práticas de privacidade. Não insira dados pessoais no campo abaixo.</p>
              </div>
              <textarea className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-purple-400 resize-none"
                placeholder="Ex: Avaliar liderança e comunicação do gestor de vendas pelos membros da equipe no último trimestre..."
                rows={5} value={aiContext} onChange={e => setAiContext(e.target.value)} />
              <button onClick={generateAI} disabled={aiLoading||!aiContext.trim()}
                className="w-full mt-3 py-2.5 text-sm font-medium text-white rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90"
                style={{ background:GRAD }}>
                {aiLoading ? <><Loader2 size={14} className="animate-spin" />Gerando...</> : <><Sparkles size={14} />Gerar com IA</>}
              </button>
              {aiQs.length>0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-600">{aiQs.length} perguntas geradas</span>
                    <button onClick={() => setQuestions(p => [...p,...aiQs.map((q,i) => ({ id:Date.now()+i,...q }))])}
                      className="text-xs font-semibold hover:opacity-80" style={{ color:"#5B21B6" }}>
                      Adicionar todas
                    </button>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {aiQs.map((q,i) => (
                      <div key={i} className="flex items-start gap-2 p-3 bg-purple-50 rounded-xl border border-purple-100">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-700 leading-relaxed">{q.text}</p>
                          <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[q.type]||"bg-slate-100 text-slate-600"}`}>
                            {TYPE_LABELS[q.type]||q.type}
                          </span>
                        </div>
                        <button onClick={() => setQuestions(p => [...p,{ id:Date.now()+i,...q }])}
                          className="p-1.5 text-white rounded-lg flex-shrink-0 hover:opacity-80" style={{ background:"#5B21B6" }}>
                          <Plus size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab==="import" && (
            <>
              <h3 className="font-semibold text-slate-800 text-sm mb-4">Importar Perguntas</h3>
              <label className="block border-2 border-dashed border-slate-200 rounded-xl p-6 text-center mb-4 cursor-pointer hover:border-purple-300 transition-colors">
                <div className="text-3xl mb-2">📄</div>
                <p className="text-sm text-slate-600 mb-1">Clique para selecionar o arquivo</p>
                <p className="text-xs text-slate-400">.xlsx, .csv ou .json</p>
                <span className="inline-block mt-3 px-4 py-2 text-white text-xs rounded-xl" style={{ background:GRAD }}>Selecionar Arquivo</span>
                <input type="file" accept=".xlsx,.xls,.csv,.json,text/csv,application/json" onChange={onImportFile} className="hidden" />
              </label>
              {importErr  && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm flex items-center gap-2"><AlertTriangle size={14} />{importErr}</div>}
              {importInfo && <div className="mb-3 bg-green-50 border border-green-200 text-green-700 rounded-xl px-3 py-2 text-sm flex items-center gap-2"><CheckCircle size={14} />{importInfo}</div>}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-600 mb-2">Formato da planilha</p>
                <p className="text-xs text-slate-500 mb-2 leading-relaxed">Uma pergunta por linha, com estas colunas:</p>
                <ul className="text-xs text-slate-600 space-y-1.5 mb-3 list-disc pl-4">
                  <li><strong>Pergunta</strong> — o texto da pergunta (obrigatório).</li>
                  <li><strong>Tipo</strong> — nps, escala, estrelas, sim/não, múltipla ou texto.</li>
                  <li><strong>Opções</strong> — apenas para escala e múltipla; separadas por “;”.</li>
                </ul>
                <p className="text-xs text-slate-400">As perguntas importadas aparecem ao lado para você revisar antes de publicar.</p>
              </div>
            </>
          )}
        </div>

        {/* RIGHT */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800 text-sm">Perguntas do Questionário</h3>
            <span className="text-xs bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-medium">
              {questions.length} pergunta{questions.length!==1?"s":""}
            </span>
          </div>
          <div className="flex-1 p-5 space-y-2 overflow-y-auto" style={{ minHeight:300 }}>
            {questions.length===0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-10">
                <div className="text-4xl mb-3">📝</div>
                <p className="text-sm font-medium text-slate-500">Nenhuma pergunta ainda</p>
                <p className="text-xs text-slate-400 mt-1">Use o painel ao lado para criar ou importar</p>
              </div>
            ) : questions.map((q,i) => (
              <div key={q.id} className="flex items-start gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100 group">
                <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">{i+1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 leading-relaxed">{q.text}</p>
                  <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[q.type]||"bg-slate-100 text-slate-600"}`}>
                    {TYPE_LABELS[q.type]||q.type}
                  </span>
                </div>
                <button onClick={() => setQuestions(p => p.filter(x => x.id!==q.id))}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all flex-shrink-0">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RESPONDENTS ───────────────────────────────────────────────────────────────
function RespondentManager() {
  const [activeGroup, setActiveGroup] = useState("todos");
  const [search,      setSearch]      = useState("");
  const [respondents, setRespondents] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [showForm, setShowForm]   = useState(false);
  const [fName,    setFName]      = useState("");
  const [fEmail,   setFEmail]     = useState("");
  const [fGroup,   setFGroup]     = useState("subordinados");
  const [fDept,    setFDept]      = useState("");
  const [fRole,    setFRole]      = useState("");
  const [saving,   setSaving]     = useState(false);
  const [formError,setFormError]  = useState("");

  const resetForm = () => { setFName(""); setFEmail(""); setFGroup("subordinados"); setFDept(""); setFRole(""); setFormError(""); };

  const handleAdd = async () => {
    setFormError("");
    if (!fName.trim()) { setFormError("O nome é obrigatório."); return; }
    setSaving(true);
    try {
      const res = await api.respondents.create({
        name: fName.trim(),
        email: fEmail.trim() || undefined,
        groupType: fGroup,
        department: fDept.trim() || undefined,
        role: fRole.trim() || undefined,
      });
      const r = res.respondent;
      setRespondents(prev => [{
        id: r.id, name: r.name || "—", email: r.email || "—", group: r.group_type || "subordinados",
        department: r.department || "—", role: r.role || "", consent: !!r.consent_given,
        status: r.consent_given ? "ativo" : "pendente",
      }, ...prev]);
      resetForm(); setShowForm(false);
    } catch (e) {
      setFormError(e.message || "Erro ao adicionar respondente.");
    }
    setSaving(false);
  };

  const [showImport,   setShowImport]   = useState(false);
  const [csvText,      setCsvText]      = useState("");
  const [importing,    setImporting]    = useState(false);
  const [importError,  setImportError]  = useState("");
  const [importResult, setImportResult] = useState("");

  const mapRow = (r) => ({
    id: r.id, name: r.name || "—", email: r.email || "—", group: r.group_type || "subordinados",
    department: r.department || "—", role: r.role || "", consent: !!r.consent_given,
    status: r.consent_given ? "ativo" : "pendente",
  });

  const handleConsent = async (r) => {
    try {
      await api.respondents.registerConsent(r.id);
      setRespondents(prev => prev.map(x => x.id===r.id ? { ...x, consent:true, status:"ativo" } : x));
    } catch (e) { alert(e.message || "Erro ao registrar consentimento."); }
  };

  const handleAnonymize = async (r) => {
    if (!window.confirm(`Anonimizar os dados de "${r.name}"? Conforme a LGPD (Art. 18), os dados pessoais serão removidos e o respondente sairá da lista. A ação é irreversível.`)) return;
    try {
      await api.respondents.remove(r.id);
      setRespondents(prev => prev.filter(x => x.id !== r.id));
    } catch (e) { alert(e.message || "Erro ao anonimizar."); }
  };

  const parseCSV = (text) => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[;,]/).map(c => c.trim().replace(/^"|"$/g, "")));

  const handleImport = async () => {
    setImportError(""); setImportResult("");
    const rows = parseCSV(csvText);
    if (rows.length === 0) { setImportError("Cole o conteúdo do CSV ou selecione um arquivo."); return; }
    let data = rows;
    const head = rows[0].map(c => c.toLowerCase());
    if (head.some(c => c === "nome" || c === "name") || head.some(c => c.includes("mail"))) data = rows.slice(1);
    const GMAP = { gestor:"gestores", gestores:"gestores", fornecedor:"fornecedores", fornecedores:"fornecedores", subordinado:"subordinados", subordinados:"subordinados" };
    const list = data.map(c => ({
      name: c[0] || "", email: c[1] || undefined,
      groupType: GMAP[(c[2] || "").toLowerCase()] || "subordinados",
      department: c[3] || undefined, role: c[4] || undefined,
    })).filter(x => x.name);
    if (list.length === 0) { setImportError("Nenhuma linha válida — cada linha precisa de um nome na 1ª coluna."); return; }
    setImporting(true);
    try {
      const res = await api.respondents.import(list);
      const fresh = await api.respondents.list();
      setRespondents((fresh.respondents || []).map(mapRow));
      setImportResult(`${res.imported} respondente(s) importado(s) com sucesso.`);
      setCsvText("");
    } catch (e) { setImportError(e.message || "Erro ao importar."); }
    setImporting(false);
  };

  const onCsvFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(file);
  };

  const handleExportCSV = () => {
    const GLAB = { gestores:"Gestores", fornecedores:"Fornecedores", subordinados:"Subordinados" };
    const rows = [["Nome","E-mail","Grupo","Departamento","Cargo","Status","Consentimento LGPD"]];
    filtered.forEach(r => rows.push([
      r.name, r.email === "—" ? "" : r.email, GLAB[r.group] || r.group,
      r.department === "—" ? "" : r.department, r.role,
      r.consent ? "Ativo" : "Pendente", r.consent ? "Coletado" : "Pendente",
    ]));
    downloadCSV(`respondentes-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.respondents.list();
        const mapped = (data.respondents || []).map(r => ({
          id:         r.id,
          name:       r.name || "—",
          email:      r.email || "—",
          group:      r.group_type || "subordinados",
          department: r.department || "—",
          role:       r.role || "",
          consent:    !!r.consent_given,
          status:     r.consent_given ? "ativo" : "pendente",
        }));
        if (alive) { setRespondents(mapped); setLoading(false); }
      } catch (e) {
        if (alive) { setError(e.message || "Erro ao carregar respondentes."); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, []);

  const counts = {
    todos:        respondents.length,
    gestores:     respondents.filter(r => r.group==="gestores").length,
    fornecedores: respondents.filter(r => r.group==="fornecedores").length,
    subordinados: respondents.filter(r => r.group==="subordinados").length,
  };

  const filtered = respondents.filter(r => {
    const mg = activeGroup==="todos" || r.group===activeGroup;
    const ms = r.name.toLowerCase().includes(search.toLowerCase()) || r.email.toLowerCase().includes(search.toLowerCase());
    return mg && ms;
  });

  const pending = respondents.filter(r => !r.consent).length;

  if (loading) return <div className="p-8 flex items-center justify-center text-slate-400 text-sm gap-2" style={{ minHeight:"60vh" }}><Loader2 size={18} className="animate-spin" />Carregando respondentes...</div>;
  if (error)   return <div className="p-8"><div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2"><AlertTriangle size={15} />{error}</div></div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Respondentes</h1>
          <p className="text-sm text-slate-500 mt-1">Gerencie participantes e consentimentos LGPD por grupo.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExportCSV} disabled={filtered.length===0} title="Baixar a lista atual em CSV" className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={14} />Exportar CSV
          </button>
          <button onClick={() => { setShowImport(s => !s); setImportError(""); setImportResult(""); }} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50">
            <Download size={14} />Importar CSV
          </button>
          <button onClick={() => { setShowForm(s => !s); setFormError(""); }} className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm hover:opacity-90" style={{ background:GRAD }}>
            <Plus size={14} />Adicionar
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm mb-5">
          <h3 className="font-semibold text-slate-800 text-sm mb-4">Novo Respondente</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Nome *</label>
              <input value={fName} onChange={e=>setFName(e.target.value)} placeholder="Nome completo" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">E-mail</label>
              <input value={fEmail} onChange={e=>setFEmail(e.target.value)} placeholder="email@empresa.com" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Grupo</label>
              <select value={fGroup} onChange={e=>setFGroup(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none bg-white">
                <option value="gestores">Gestores</option>
                <option value="fornecedores">Fornecedores</option>
                <option value="subordinados">Subordinados</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Departamento</label>
              <input value={fDept} onChange={e=>setFDept(e.target.value)} placeholder="Ex: Vendas" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-400" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 block mb-1">Cargo</label>
              <input value={fRole} onChange={e=>setFRole(e.target.value)} placeholder="Ex: Analista de Vendas" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-400" />
            </div>
          </div>
          {formError && <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm flex items-center gap-2"><AlertTriangle size={14} />{formError}</div>}
          <div className="flex gap-2 mt-4">
            <button onClick={handleAdd} disabled={saving} className="px-4 py-2.5 text-sm text-white rounded-xl hover:opacity-90 disabled:opacity-60 flex items-center gap-2" style={{ background:GRAD }}>
              {saving ? <><Loader2 size={14} className="animate-spin" />Salvando...</> : <><Plus size={14} />Adicionar respondente</>}
            </button>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Cancelar</button>
          </div>
          <p className="text-xs text-slate-400 mt-3">O consentimento LGPD é registrado à parte — novos respondentes entram como "Pendente".</p>
        </div>
      )}

      {showImport && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm mb-5">
          <h3 className="font-semibold text-slate-800 text-sm mb-2">Importar respondentes (CSV)</h3>
          <p className="text-xs text-slate-500 mb-3">Colunas na ordem: <strong>Nome, E-mail, Grupo, Departamento, Cargo</strong>. Separador vírgula ou ponto-e-vírgula. Grupo aceita: gestores, fornecedores, subordinados. Uma linha de cabeçalho é detectada e ignorada automaticamente.</p>
          <div className="flex items-center gap-3 mb-3">
            <label className="text-xs font-medium text-slate-600 px-3 py-2 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 inline-flex items-center gap-2">
              <Download size={13} />Selecionar arquivo .csv
              <input type="file" accept=".csv,text/csv" onChange={onCsvFile} className="hidden" />
            </label>
            <span className="text-xs text-slate-400">ou cole o conteúdo abaixo</span>
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={6}
            placeholder={"Nome,E-mail,Grupo,Departamento,Cargo\nJoão Silva,joao@rgis.com,gestores,Vendas,Gerente\nMaria Souza,maria@rgis.com,subordinados,RH,Analista"}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-purple-400 resize-none" />
          {importError  && <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm flex items-center gap-2"><AlertTriangle size={14} />{importError}</div>}
          {importResult && <div className="mt-3 bg-green-50 border border-green-200 text-green-700 rounded-xl px-3 py-2 text-sm flex items-center gap-2"><CheckCircle size={14} />{importResult}</div>}
          <div className="flex gap-2 mt-4">
            <button onClick={handleImport} disabled={importing} className="px-4 py-2.5 text-sm text-white rounded-xl hover:opacity-90 disabled:opacity-60 flex items-center gap-2" style={{ background:GRAD }}>
              {importing ? <><Loader2 size={14} className="animate-spin" />Importando...</> : <><Download size={14} />Importar</>}
            </button>
            <button onClick={() => { setShowImport(false); setCsvText(""); setImportError(""); setImportResult(""); }} className="px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Fechar</button>
          </div>
        </div>
      )}

      {pending>0 && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl mb-5">
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Consentimento pendente para {pending} respondente{pending>1?"s":""}</p>
            <p className="text-xs text-amber-700 mt-0.5">Não é possível enviar pesquisas para respondentes sem consentimento LGPD registrado.</p>
          </div>
          <button disabled title="Recurso em desenvolvimento" className="ml-auto text-xs font-semibold text-amber-700 border border-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed">
            Enviar solicitação
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-5">
        {[
          { id:"todos",        label:"Todos",        Icon:Users      },
          { id:"gestores",     label:"Gestores",     Icon:UserCheck  },
          { id:"fornecedores", label:"Fornecedores", Icon:Building2  },
          { id:"subordinados", label:"Subordinados", Icon:Users      },
        ].map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setActiveGroup(id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${activeGroup===id?"border-purple-300 bg-purple-50 text-purple-700":"border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            <Icon size={14} />{label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${activeGroup===id?"bg-purple-100 text-purple-600":"bg-slate-100 text-slate-500"}`}>
              {counts[id]}
            </span>
          </button>
        ))}
      </div>

      <div className="relative mb-4 max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-purple-400"
          placeholder="Buscar por nome ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              {["Nome","E-mail","Grupo","Departamento","Status","Consentimento LGPD","Ações"].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-slate-500 px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r,i) => (
              <tr key={r.id} className={`hover:bg-slate-50 transition-colors ${i<filtered.length-1?"border-b border-slate-50":""}`}>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background:GRAD }}>
                      {r.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-800">{r.name}</div>
                      <div className="text-xs text-slate-400">{r.role}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-sm text-slate-600">{r.email}</td>
                <td className="px-4 py-3.5"><GroupBadge group={r.group} /></td>
                <td className="px-4 py-3.5 text-sm text-slate-600">{r.department}</td>
                <td className="px-4 py-3.5"><Badge status={r.status} /></td>
                <td className="px-4 py-3.5">
                  {r.consent
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><Shield size={10} />Coletado</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full"><AlertTriangle size={10} />Pendente</span>
                  }
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-1">
                    {!r.consent && (
                      <button onClick={() => handleConsent(r)} title="Registrar consentimento LGPD"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50 transition-colors"><Shield size={13} /></button>
                    )}
                    <button onClick={() => handleAnonymize(r)} title="Anonimizar dados (LGPD Art. 18)"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 360° EVALUATION ──────────────────────────────────────────────────────────
// ─── EVALUATION 360° ─────────────────────────────────────────────────────────
const EVAL_RELS = [
  { v:"auto",        label:"Autoavaliação" },
  { v:"gestor",      label:"Gestor" },
  { v:"par",         label:"Par (colega)" },
  { v:"subordinado", label:"Subordinado" },
];
const EVAL_REL_LABEL = { auto:"Autoavaliação", gestor:"Gestor", par:"Par", subordinado:"Subordinado" };
function score360Color(v) {
  if (v === null || v === undefined) return "bg-slate-100 text-slate-400";
  if (v >= 80) return "bg-green-100 text-green-700";
  if (v >= 60) return "bg-blue-100 text-blue-700";
  if (v >= 40) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function Evaluation360() {
  const [view, setView]         = useState("list");   // "list" | "detail"
  const [activeCycle, setActive]= useState(null);
  const [cycles, setCycles]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [creating, setCreating] = useState(false);
  const [surveys, setSurveys]   = useState([]);
  const [form, setForm]         = useState({ name:"", surveyId:"" });
  const [saving, setSaving]     = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try { const r = await api.eval.cycles(); setCycles(r.cycles || []); }
    catch (e) { setError(e.message || "Erro ao carregar ciclos."); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleCreate = async () => {
    setCreating(c => !c); setError("");
    if (surveys.length === 0) {
      try { const s = await api.surveys.list(); setSurveys(s.surveys || []); } catch {}
    }
  };

  const submitCreate = async () => {
    if (!form.name.trim() || !form.surveyId) { setError("Informe o nome do ciclo e escolha o questionário."); return; }
    setSaving(true); setError("");
    try {
      const r = await api.eval.createCycle(form.name.trim(), form.surveyId);
      setForm({ name:"", surveyId:"" }); setCreating(false);
      await load();
      if (r.cycle) { setActive(r.cycle.id); setView("detail"); }
    } catch (e) { setError(e.message || "Erro ao criar ciclo."); }
    setSaving(false);
  };

  if (view === "detail" && activeCycle) {
    return <CycleDetail cycleId={activeCycle} onBack={() => { setView("list"); setActive(null); load(); }} />;
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Avaliação 360°</h1>
          <p className="text-sm text-slate-500 mt-1">Ciclos de avaliação com múltiplas perspectivas e anonimização LGPD.</p>
        </div>
        <button onClick={toggleCreate} className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm hover:opacity-90" style={{ background:GRAD }}>
          <Plus size={14} />Novo Ciclo
        </button>
      </div>

      {creating && (
        <div className="bg-white rounded-2xl p-5 mb-6 border border-purple-200 shadow-sm">
          <h3 className="font-semibold text-slate-800 text-sm mb-3">Novo ciclo de avaliação</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Nome do ciclo</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name:e.target.value }))} placeholder="Ex: Ciclo 360° Liderança Q3"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Questionário (pesquisa)</label>
              <select value={form.surveyId} onChange={e => setForm(f => ({ ...f, surveyId:e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
                <option value="">Selecione...</option>
                {surveys.map(s => <option key={s.id} value={s.id}>{s.name}{s.question_count!=null?` (${s.question_count} perguntas)`:""}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">O questionário deve ter perguntas de escala, nota/NPS ou estrelas para gerar a matriz. Crie-o antes em “Pesquisas”.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={submitCreate} disabled={saving} className="px-4 py-2 text-white rounded-xl text-sm hover:opacity-90 disabled:opacity-50" style={{ background:GRAD }}>
              {saving ? "Criando..." : "Criar ciclo"}
            </button>
            <button onClick={() => { setCreating(false); setError(""); }} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50">Cancelar</button>
          </div>
        </div>
      )}

      <div className="rounded-2xl p-5 mb-6 border border-purple-100" style={{ background:"linear-gradient(135deg,#f5f3ff,#ede9fe)" }}>
        <h3 className="font-semibold text-purple-800 text-sm mb-3">Como funciona a Avaliação 360°</h3>
        <div className="grid grid-cols-4 gap-3">
          {[["👤","Autoavaliação","O colaborador se avalia"],["⬆️","Gestor avalia","O líder avalia o colaborador"],["↔️","Pares avaliam","Colegas avaliam entre si"],["⬇️","Equipe avalia","Subordinados avaliam o gestor"]].map(([e,t,d],i) => (
            <div key={i} className="bg-white rounded-xl p-3 text-center border border-purple-100">
              <div className="text-xl mb-1">{e}</div>
              <div className="text-xs font-semibold text-slate-700">{t}</div>
              <div className="text-xs text-slate-400 mt-0.5 leading-tight">{d}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-purple-700 bg-white bg-opacity-70 px-3 py-2 rounded-xl border border-purple-100">
          <Shield size={12} className="text-green-600" />
          As avaliações são confidenciais e usadas de forma agregada, conforme a LGPD. Os avaliadores não são identificados nos resultados.
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2 mb-5"><AlertTriangle size={15} />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center text-slate-400 text-sm gap-2 py-16"><Loader2 size={18} className="animate-spin" />Carregando ciclos...</div>
      ) : cycles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background:"#F5F3FF" }}><Target size={22} style={{ color:"#7C3AED" }} /></div>
          <h3 className="font-semibold text-slate-800 text-sm">Nenhum ciclo de avaliação ainda</h3>
          <p className="text-sm text-slate-500 mt-1 mb-4">Crie um ciclo, escolha o questionário e atribua avaliadores por relação.</p>
          <button onClick={toggleCreate} className="inline-flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm hover:opacity-90" style={{ background:GRAD }}><Plus size={14} />Criar primeiro ciclo</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {cycles.map(c => {
            const total = c.total_assignments || 0, done = c.completed_assignments || 0;
            const pct = total ? Math.round((done/total)*100) : 0;
            return (
              <div key={c.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-800 text-sm">{c.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{c.survey_name || "Sem questionário"}</p>
                  </div>
                  <Badge status={c.status} />
                </div>
                <div className="flex items-center gap-5 mb-4">
                  <div><div className="text-xl font-bold text-slate-800">{c.subjects||0}</div><div className="text-xs text-slate-400">Avaliados</div></div>
                  <div><div className="text-xl font-bold" style={{ color:"#5B21B6" }}>{done}/{total}</div><div className="text-xs text-slate-400">Respostas</div></div>
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-slate-500 mb-1"><span>Conclusão</span><span className="font-medium">{pct}%</span></div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${pct}%`, background:GRAD }} /></div>
                  </div>
                </div>
                <button onClick={() => { setActive(c.id); setView("detail"); }} className="w-full py-2 text-xs border rounded-xl hover:opacity-80" style={{ borderColor:"#5B21B6", color:"#5B21B6" }}>Abrir ciclo</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CycleDetail({ cycleId, onBack }) {
  const [data, setData]         = useState(null);   // { cycle, assignments }
  const [matrix, setMatrix]     = useState([]);
  const [respondents, setResp]  = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [form, setForm]         = useState({ subjectId:"", relationship:"auto", evaluatorName:"", evaluatorEmail:"" });
  const [saving, setSaving]     = useState(false);
  const [lastLink, setLastLink] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [d, res, rp] = await Promise.all([
        api.eval.cycle(cycleId),
        api.eval.results(cycleId).catch(() => ({ matrix:[] })),
        api.respondents.list().catch(() => ({ respondents:[] })),
      ]);
      setData(d); setMatrix(res.matrix || []); setResp(rp.respondents || []);
    } catch (e) { setError(e.message || "Erro ao carregar o ciclo."); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [cycleId]);

  const linkFor = (token) => `${window.location.origin}/eval/${token}`;
  const fallbackCopy = (url, id) => { try { const ta=document.createElement("textarea"); ta.value=url; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); setCopiedId(id); setTimeout(()=>setCopiedId(null),1500); } catch {} };
  const copy = (token, id) => {
    const url = linkFor(token);
    try { navigator.clipboard.writeText(url).then(() => { setCopiedId(id); setTimeout(()=>setCopiedId(null),1500); }, () => fallbackCopy(url, id)); }
    catch { fallbackCopy(url, id); }
  };

  const submitAssign = async () => {
    if (!form.subjectId || !form.relationship) { setError("Escolha o avaliado e a relação."); return; }
    setSaving(true); setError(""); setLastLink("");
    try {
      const r = await api.eval.addAssignment(cycleId, {
        subjectId: form.subjectId, relationship: form.relationship,
        evaluatorName: form.evaluatorName.trim() || undefined,
        evaluatorEmail: form.evaluatorEmail.trim() || undefined,
      });
      if (r.assignment) setLastLink(linkFor(r.assignment.token));
      setForm(f => ({ ...f, evaluatorName:"", evaluatorEmail:"" }));
      await load();
    } catch (e) { setError(e.message || "Erro ao atribuir avaliador."); }
    setSaving(false);
  };

  const removeAssign = async (id) => {
    if (!window.confirm("Remover esta atribuição?")) return;
    try { await api.eval.removeAssignment(id); await load(); }
    catch (e) { setError(e.message || "Erro ao remover."); }
  };

  const cycle = data?.cycle;
  const assignments = data?.assignments || [];
  const groups = {};
  assignments.forEach(a => { (groups[a.subject_id] = groups[a.subject_id] || { name:a.subject_name, items:[] }).items.push(a); });

  return (
    <div className="p-8">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700 mb-4">← Voltar aos ciclos</button>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{cycle?.name || "Ciclo"}</h1>
          <p className="text-sm text-slate-500 mt-1">Questionário: {cycle?.survey_name || "—"}</p>
        </div>
        {cycle && <Badge status={cycle.status} />}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2 mb-5"><AlertTriangle size={15} />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center text-slate-400 text-sm gap-2 py-16"><Loader2 size={18} className="animate-spin" />Carregando...</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl p-5 mb-6 border border-slate-100 shadow-sm">
            <h3 className="font-semibold text-slate-800 text-sm mb-3">Atribuir avaliador</h3>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Avaliado</label>
                <select value={form.subjectId} onChange={e => setForm(f => ({ ...f, subjectId:e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
                  <option value="">Selecione...</option>
                  {respondents.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Relação</label>
                <select value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship:e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
                  {EVAL_RELS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Nome do avaliador <span className="text-slate-300">(opcional)</span></label>
                <input value={form.evaluatorName} onChange={e => setForm(f => ({ ...f, evaluatorName:e.target.value }))} placeholder="Para sua referência"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">E-mail <span className="text-slate-300">(opcional)</span></label>
                <input value={form.evaluatorEmail} onChange={e => setForm(f => ({ ...f, evaluatorEmail:e.target.value }))} placeholder="email@empresa.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
              </div>
            </div>
            {respondents.length === 0 && <p className="text-xs text-amber-600 mt-2">Você ainda não tem respondentes cadastrados. Adicione-os em “Respondentes” para escolher o avaliado.</p>}
            <div className="mt-3">
              <button onClick={submitAssign} disabled={saving} className="px-4 py-2 text-white rounded-xl text-sm hover:opacity-90 disabled:opacity-50" style={{ background:GRAD }}>
                {saving ? "Gerando link..." : "Atribuir e gerar link"}
              </button>
            </div>
            {lastLink && (
              <div className="mt-3 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                <CheckCircle size={15} className="text-green-600 flex-shrink-0" />
                <input readOnly value={lastLink} className="flex-1 bg-transparent text-xs text-slate-600 focus:outline-none" />
                <button onClick={() => copy(lastLink.split("/eval/")[1], "last")} className="text-xs font-medium px-2 py-1 rounded-lg hover:bg-green-100" style={{ color:"#16A34A" }}>{copiedId==="last"?"Copiado!":"Copiar"}</button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-6 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100"><h3 className="font-semibold text-slate-800 text-sm">Avaliadores atribuídos</h3></div>
            {Object.keys(groups).length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-slate-400">Nenhum avaliador atribuído ainda. Use o formulário acima.</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {Object.entries(groups).map(([sid, g]) => (
                  <div key={sid} className="px-6 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ background:GRAD }}>{(g.name||"?").charAt(0)}</div>
                      <span className="text-sm font-semibold text-slate-800">{g.name || "—"}</span>
                      <span className="text-xs text-slate-400">· {g.items.length} avaliador{g.items.length!==1?"es":""}</span>
                    </div>
                    <div className="space-y-1.5 pl-9">
                      {g.items.map(a => (
                        <div key={a.id} className="flex items-center gap-3 text-sm">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 w-28 text-center flex-shrink-0">{EVAL_REL_LABEL[a.relationship]||a.relationship}</span>
                          <span className="text-slate-600 flex-1 truncate">{a.evaluator_name || a.evaluator_email || "Avaliador sem nome"}</span>
                          {a.completed
                            ? <span className="flex items-center gap-1 text-xs text-green-600 flex-shrink-0"><CheckCircle size={13} />Concluído</span>
                            : <span className="flex items-center gap-1 text-xs text-amber-500 flex-shrink-0"><Clock size={13} />Pendente</span>}
                          <button onClick={() => copy(a.token, a.id)} title="Copiar link do avaliador" className="flex items-center gap-1 text-xs text-slate-500 hover:text-purple-700 flex-shrink-0"><Link2 size={13} />{copiedId===a.id?"Copiado!":"Link"}</button>
                          <button onClick={() => removeAssign(a.id)} title="Remover" className="text-slate-300 hover:text-red-500 flex-shrink-0"><Trash2 size={13} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 text-sm">Matriz de resultados</h3>
              <p className="text-xs text-slate-400 mt-0.5">Scores normalizados de 0 a 100 por perspectiva · só respostas concluídas</p>
            </div>
            {matrix.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-slate-400">Sem resultados ainda. Os scores aparecem conforme os avaliadores respondem.</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {["Avaliado","👤 Auto","⬆️ Gestor","↔️ Par","⬇️ Subord.","📊 Geral"].map(h => (
                      <th key={h} className={`text-xs font-semibold text-slate-500 px-5 py-3 ${h==="Avaliado"?"text-left":"text-center"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row,i) => (
                    <tr key={row.subjectId} className={`hover:bg-slate-50 transition-colors ${i<matrix.length-1?"border-b border-slate-50":""}`}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ background:GRAD }}>{(row.subjectName||"?").charAt(0)}</div>
                          <span className="text-sm font-medium text-slate-800">{row.subjectName}</span>
                        </div>
                      </td>
                      {[row.auto,row.gestor,row.par,row.subordinado].map((v,j) => (
                        <td key={j} className="px-5 py-4 text-center text-sm font-semibold text-slate-700">{v==null?"—":v}</td>
                      ))}
                      <td className="px-5 py-4 text-center">
                        <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${score360Color(row.overall)}`}>{row.overall==null?"—":row.overall}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── RESULTS ───────────────────────────────────────────────────────────────────
function QuestionResult({ q }) {
  // NPS
  if (q.type === "nps") {
    const parts = [
      { label:"Promotores", pct:q.promoters||0, color:"#10B981" },
      { label:"Neutros",    pct:q.passives||0,  color:"#94A3B8" },
      { label:"Detratores", pct:q.detractors||0,color:"#EF4444" },
    ];
    return (
      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <h4 className="text-sm font-medium text-slate-700 flex-1 pr-4">{q.text}</h4>
          <span className="text-xs text-slate-400 whitespace-nowrap">{q.responseCount} resposta(s)</span>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-center">
            <div className="text-3xl font-bold" style={{ color:"#5B21B6" }}>{q.nps}</div>
            <div className="text-xs text-slate-400 mt-0.5">NPS · {q.classification}</div>
          </div>
          <div className="flex-1 space-y-2">
            {parts.map((p,i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-20">{p.label}</span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${p.pct}%`,background:p.color }} /></div>
                <span className="text-xs font-semibold text-slate-700 w-9 text-right">{p.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  // Escala / Estrelas
  if (q.type === "scale" || q.type === "rating") {
    const dist = q.distribution || [];
    return (
      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <h4 className="text-sm font-medium text-slate-700 flex-1 pr-4">{q.text}</h4>
          <span className="text-xs text-slate-400 whitespace-nowrap">{q.responseCount} resposta(s)</span>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-center">
            <div className="text-3xl font-bold" style={{ color:"#5B21B6" }}>{q.average ?? "—"}</div>
            <div className="text-xs text-slate-400 mt-0.5">média</div>
          </div>
          <div className="flex-1 space-y-1.5">
            {dist.length === 0 ? <span className="text-xs text-slate-400">Sem respostas.</span> : dist.map((d,i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-8">{d.value}</span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${d.pct}%`,background:"#5B21B6" }} /></div>
                <span className="text-xs font-semibold text-slate-700 w-9 text-right">{d.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  // Sim / Não
  if (q.type === "yesno") {
    return (
      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <h4 className="text-sm font-medium text-slate-700 flex-1 pr-4">{q.text}</h4>
          <span className="text-xs text-slate-400 whitespace-nowrap">{(q.yes||0)+(q.no||0)} resposta(s)</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-12">Sim</span>
              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${q.yesPct||0}%`,background:"#10B981" }} /></div>
              <span className="text-xs font-semibold text-slate-700 w-9 text-right">{q.yesPct||0}%</span>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-slate-500 w-12">Não</span>
              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${100-(q.yesPct||0)}%`,background:"#EF4444" }} /></div>
              <span className="text-xs font-semibold text-slate-700 w-9 text-right">{100-(q.yesPct||0)}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  // Múltipla escolha
  if (q.type === "multiple") {
    const freq = q.frequency || [];
    return (
      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <h4 className="text-sm font-medium text-slate-700 flex-1 pr-4">{q.text}</h4>
          <span className="text-xs text-slate-400 whitespace-nowrap">{q.responseCount} resposta(s)</span>
        </div>
        <div className="space-y-1.5">
          {freq.length === 0 ? <span className="text-xs text-slate-400">Sem respostas.</span> : freq.map((d,i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-xs text-slate-500 flex-1 truncate">{d.value}</span>
              <div className="w-32 h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${d.pct}%`,background:"#5B21B6" }} /></div>
              <span className="text-xs font-semibold text-slate-700 w-9 text-right">{d.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  // Texto aberto
  if (q.type === "text") {
    const arr = q.responses || [];
    return (
      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
        <div className="flex items-start justify-between mb-3">
          <h4 className="text-sm font-medium text-slate-700 flex-1 pr-4">{q.text}</h4>
          <span className="text-xs text-slate-400 whitespace-nowrap">{arr.length} resposta(s)</span>
        </div>
        {arr.length === 0 ? <span className="text-xs text-slate-400">Sem respostas.</span> : (
          <div className="space-y-2 max-h-44 overflow-y-auto">
            {arr.map((t,i) => <div key={i} className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">{t}</div>)}
          </div>
        )}
      </div>
    );
  }
  return null;
}

function ResultsDashboard() {
  const [surveys,       setSurveys]       = useState([]);
  const [selectedId,    setSelectedId]    = useState(null);
  const [result,        setResult]        = useState(null);
  const [loadingList,   setLoadingList]   = useState(true);
  const [loadingResult, setLoadingResult] = useState(false);
  const [error,         setError]         = useState("");

  useEffect(() => {
    (async () => {
      setLoadingList(true); setError("");
      try {
        const sv = await api.surveys.list();
        const list = sv.surveys || [];
        setSurveys(list);
        const pick = list.find(s => (s.response_count||0) > 0) || list[0];
        if (pick) setSelectedId(pick.id);
      } catch (e) { setError(e.message || "Erro ao carregar pesquisas."); }
      setLoadingList(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) { setResult(null); return; }
    let alive = true;
    (async () => {
      setLoadingResult(true);
      try { const r = await api.get(`/results/${selectedId}`); if (alive) setResult(r); }
      catch (e) { if (alive) setError(e.message || "Erro ao carregar resultados."); }
      if (alive) setLoadingResult(false);
    })();
    return () => { alive = false; };
  }, [selectedId]);

  if (loadingList) return <div className="p-8 flex items-center justify-center text-slate-400 text-sm gap-2" style={{ minHeight:"60vh" }}><Loader2 size={18} className="animate-spin" />Carregando resultados...</div>;
  if (error)       return <div className="p-8"><div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2"><AlertTriangle size={15} />{error}</div></div>;

  const survey   = result?.survey;
  const totalR   = survey?.totalResponses ?? 0;
  const compRate = result?.completionRate ?? 0;
  const nps      = result?.overallNPS;
  const anon     = !!survey?.anonymous;
  const questions = result?.questions || [];

  const handleExportCSV = () => {
    if (!questions.length) return;
    const rows = [["Pergunta","Tipo","Respostas","Resumo"]];
    questions.forEach(q => {
      let resumo = "";
      if (q.type === "nps") resumo = `NPS ${q.nps} (${q.classification||""}) · ${q.promoters||0}% prom / ${q.detractors||0}% detr`;
      else if (q.type === "scale" || q.type === "rating") resumo = `Média ${q.average ?? "—"}`;
      else if (q.type === "yesno") resumo = `Sim ${q.yesPct ?? 0}% (${q.yes||0} de ${(q.yes||0)+(q.no||0)})`;
      else if (q.type === "multiple") resumo = (q.frequency||[]).map(f => `${f.value}: ${f.pct}%`).join(" | ");
      else if (q.type === "text") resumo = `${(q.responses||[]).length} resposta(s) aberta(s)`;
      rows.push([q.text, q.type, q.responseCount ?? 0, resumo]);
    });
    const nm = (survey?.name || "resultados").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "resultados";
    downloadCSV(`resultados-${nm}.csv`, rows);
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Resultados & Relatórios</h1>
          <p className="text-sm text-slate-500 mt-1">Análise completa por pergunta, com proteção LGPD.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExportCSV} disabled={!questions.length} title="Baixar o resumo por pergunta em CSV" className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={14} />Exportar CSV
          </button>
          <button onClick={() => window.print()} title="Abrir a janela de impressão (salve como PDF)" className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50">
            <Download size={14} />Exportar PDF
          </button>
        </div>
      </div>

      {surveys.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 border border-slate-100 shadow-sm text-center text-slate-400 text-sm">Nenhuma pesquisa criada ainda.</div>
      ) : (
      <>
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm mb-6">
        <div className="flex gap-2 overflow-x-auto">
          {surveys.map(s => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${selectedId===s.id?"text-white":"border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              style={selectedId===s.id?{ background:GRAD }:{}}>
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {loadingResult ? (
        <div className="flex items-center justify-center text-slate-400 text-sm gap-2 py-16"><Loader2 size={18} className="animate-spin" />Carregando...</div>
      ) : !result ? null : (
      <>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard title="Respostas"         value={String(totalR)}                  subtitle="Avaliações concluídas"  icon={MessageSquare} colorClass="bg-purple-500" />
        <KpiCard title="Taxa de Conclusão" value={`${compRate}%`}                   subtitle="Iniciadas vs concluídas" icon={CheckCircle}  colorClass="bg-emerald-500" />
        <KpiCard title="NPS Score"         value={nps ? String(nps.nps) : "—"}     subtitle={nps ? nps.classification : "Sem pergunta NPS"} icon={TrendingUp} colorClass="bg-blue-500" />
        <KpiCard title="Anonimato"         value={anon?"Ativo":"Inativo"}          subtitle="Proteção LGPD"          icon={Shield}        colorClass={anon?"bg-green-500":"bg-slate-400"} />
      </div>

      {totalR === 0 ? (
        <div className="bg-white rounded-2xl p-10 border border-slate-100 shadow-sm text-center text-slate-400 text-sm">
          Esta pesquisa ainda não recebeu respostas. Os resultados aparecerão aqui assim que os participantes responderem.
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q,i) => <QuestionResult key={q.questionId || i} q={q} />)}
        </div>
      )}
      </>
      )}
      </>
      )}
    </div>
  );
}


// ─── LGPD PAGE ─────────────────────────────────────────────────────────────────
function LGPDPage() {
  const [expandedRight, setExpandedRight] = useState(null);

  const rights = [
    { icon:"👁️", title:"Acesso",         desc:"O titular pode solicitar confirmação da existência do tratamento e acesso aos dados.",   art:"Art. 18, I e II" },
    { icon:"✏️", title:"Correção",        desc:"Dados incompletos, inexatos ou desatualizados devem ser corrigidos a pedido do titular.", art:"Art. 18, III"    },
    { icon:"🗑️", title:"Exclusão",        desc:"Dados desnecessários ou tratados em desconformidade podem ser eliminados.",              art:"Art. 18, VI"     },
    { icon:"📦", title:"Portabilidade",   desc:"O titular pode solicitar a portabilidade dos dados para outro fornecedor.",               art:"Art. 18, V"      },
    { icon:"🚫", title:"Oposição",        desc:"O titular pode opor-se ao tratamento realizado sem consentimento.",                      art:"Art. 18, IX"     },
    { icon:"📋", title:"Informação",      desc:"O titular tem direito de ser informado sobre o compartilhamento de dados.",              art:"Art. 18, VII"    },
  ];

  return (
    <div className="p-8">
      <div className="mb-7">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <Shield size={20} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">LGPD & Privacidade</h1>
            <p className="text-sm text-slate-500">Conformidade com a Lei Geral de Proteção de Dados nº 13.709/2018</p>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="grid grid-cols-3 gap-4 mb-7">
        {[
          { label:"Base Legal",          value:"Consentimento explícito",        status:"ok",      icon:CheckCircle },
          { label:"Encarregado (DPO)",   value:"dpo@empresa.com",                status:"ok",      icon:UserCheck   },
          { label:"Relatório de Impacto",value:"Atualizado em 01/04/2025",       status:"ok",      icon:FileText    },
          { label:"Retenção de Dados",   value:"12 meses após coleta",           status:"ok",      icon:Database    },
          { label:"Consentimentos",      value:"75% coletados (6/8)",            status:"warning", icon:AlertTriangle},
          { label:"Próxima Revisão",     value:"01/07/2025",                     status:"info",    icon:Clock       },
        ].map(({ label,value,status,icon:Icon },i) => (
          <div key={i} className={`bg-white rounded-2xl p-4 border shadow-sm flex items-start gap-3 ${status==="ok"?"border-green-200":status==="warning"?"border-amber-200":"border-blue-200"}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${status==="ok"?"bg-green-100":status==="warning"?"bg-amber-100":"bg-blue-100"}`}>
              <Icon size={16} className={status==="ok"?"text-green-600":status==="warning"?"text-amber-500":"text-blue-500"} />
            </div>
            <div>
              <div className="text-xs text-slate-500">{label}</div>
              <div className="text-sm font-semibold text-slate-800 mt-0.5">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Rights */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-6">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-sm">Direitos dos Titulares — Art. 18 da LGPD</h3>
          <p className="text-xs text-slate-400 mt-0.5">Funcionalidades disponíveis para atendimento de solicitações</p>
        </div>
        <div className="grid grid-cols-3 gap-0">
          {rights.map((r,i) => (
            <div key={i} onClick={() => setExpandedRight(expandedRight===i?null:i)}
              className={`p-5 cursor-pointer transition-colors border-slate-50 ${i<3?"border-b":""} ${i%3!==2?"border-r":""} ${expandedRight===i?"bg-purple-50":"hover:bg-slate-50"}`}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">{r.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-slate-800">{r.title}</div>
                  <div className="text-xs text-purple-600 font-medium mt-0.5">{r.art}</div>
                  {expandedRight===i && <p className="text-xs text-slate-600 mt-2 leading-relaxed">{r.desc}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Consent Log */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-sm">Registro de Consentimentos</h3>
          <button disabled title="Recurso em desenvolvimento" className="flex items-center gap-1.5 text-xs font-medium hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed" style={{ color:"#5B21B6" }}>
            <Download size={12} />Exportar log
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              {["Respondente","E-mail","Consentimento","Data","Canal"].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-slate-500 px-5 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_RESPONDENTS.map((r,i) => (
              <tr key={r.id} className={`hover:bg-slate-50 ${i<MOCK_RESPONDENTS.length-1?"border-b border-slate-50":""}`}>
                <td className="px-5 py-3 text-sm font-medium text-slate-800">{r.name}</td>
                <td className="px-5 py-3 text-sm text-slate-600">{r.email}</td>
                <td className="px-5 py-3">
                  {r.consent
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle size={10} />Coletado</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full"><Clock size={10} />Pendente</span>
                  }
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">{r.consent?"10/05/2025 09:14":"—"}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{r.consent?"E-mail":"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SECURITY PAGE ─────────────────────────────────────────────────────────────
function SecurityPage() {
  const [twoFactor, setTwoFactor] = useState(true);
  const [ipFilter,  setIpFilter]  = useState(false);

  const auditTypeStyle = {
    auth:   "bg-blue-100 text-blue-700",
    create: "bg-purple-100 text-purple-700",
    data:   "bg-green-100 text-green-700",
    export: "bg-amber-100 text-amber-700",
    alert:  "bg-red-100 text-red-700",
  };
  const auditTypeLabel = { auth:"Autenticação",create:"Criação",data:"Dados",export:"Exportação",alert:"Alerta" };

  return (
    <div className="p-8">
      <div className="mb-7 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
          <Lock size={20} className="text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Segurança Cibernética</h1>
          <p className="text-sm text-slate-500 mt-1">Controles de acesso, criptografia, autenticação e trilha de auditoria.</p>
        </div>
      </div>

      {/* Security score */}
      <div className="bg-white rounded-2xl p-5 border border-green-200 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800 text-sm">Pontuação de Segurança</h3>
          <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded-full font-semibold">Excelente</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-5xl font-bold text-emerald-500">92<span className="text-2xl text-slate-400">/100</span></div>
          <div className="flex-1 space-y-2">
            {[
              ["Criptografia TLS 1.3",     100, true ],
              ["Autenticação 2FA",          100, true ],
              ["Senhas com hash bcrypt",    100, true ],
              ["Filtro de IP",              0,   false],
              ["Backups automáticos",       100, true ],
              ["Rate limiting ativo",       100, true ],
            ].map(([label,pct,ok],i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ok?"bg-green-500":"bg-amber-400"}`} />
                <span className="text-slate-600 w-44">{label}</span>
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width:`${pct}%`,background:ok?"#10B981":"#F59E0B" }} />
                </div>
                <span className={`font-semibold w-8 text-right ${ok?"text-green-600":"text-amber-500"}`}>{pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-5 mb-6">
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <h3 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2"><Key size={15} className="text-purple-500" />Controles de Acesso</h3>
          <div className="space-y-4">
            {[
              { label:"Autenticação de 2 fatores (2FA)", desc:"Obrigatório para todos os usuários admin", val:twoFactor, set:setTwoFactor },
              { label:"Filtro por IP permitido",          desc:"Restringe acesso a IPs cadastrados",       val:ipFilter,  set:setIpFilter  },
            ].map(({ label,desc,val,set },i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-slate-800">{label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{desc}</div>
                </div>
                <div onClick={() => set(!val)}
                  className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer ${val?"bg-green-500":"bg-slate-300"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${val?"translate-x-5":"translate-x-0.5"}`} />
                </div>
              </div>
            ))}
            <div className="pt-2">
              <div className="text-sm font-medium text-slate-800 mb-1">Política de Senha</div>
              <div className="text-xs text-slate-500 leading-relaxed">Mínimo 12 caracteres · Letras maiúsculas e minúsculas · Números · Símbolos · Hash bcrypt (custo 12)</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <h3 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2"><Database size={15} className="text-blue-500" />Proteção de Dados</h3>
          <div className="space-y-3">
            {[
              ["Criptografia em trânsito",  "TLS 1.3 com HSTS habilitado",         "green"],
              ["Criptografia em repouso",   "AES-256 para dados sensíveis",         "green"],
              ["Anonymização automática",   "Ativa em pesquisas configuradas",      "green"],
              ["Retenção de dados",         "Exclusão automática após 12 meses",    "green"],
              ["Backup automatizado",       "Diário com retenção de 30 dias",       "green"],
              ["SQL Injection / XSS",       "Sanitização e validação ativas",       "green"],
            ].map(([label,value,color],i) => (
              <div key={i} className="flex items-start justify-between text-xs py-2 border-b border-slate-50 last:border-0 gap-3">
                <span className="text-slate-600">{label}</span>
                <span className="font-medium text-green-700 text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Audit Log */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Activity size={15} className="text-slate-500" />Trilha de Auditoria
          </h3>
          <div className="flex gap-2">
            <button disabled title="Recurso em desenvolvimento" className="flex items-center gap-1.5 text-xs border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <RefreshCw size={11} />Atualizar
            </button>
            <button disabled title="Recurso em desenvolvimento" className="flex items-center gap-1.5 text-xs font-medium hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed" style={{ color:"#5B21B6" }}>
              <Download size={11} />Exportar
            </button>
          </div>
        </div>
        <div className="divide-y divide-slate-50">
          {AUDIT_LOG.map(log => (
            <div key={log.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${auditTypeStyle[log.type]}`}>
                {auditTypeLabel[log.type]}
              </span>
              <span className="text-sm text-slate-700 flex-1">{log.action}</span>
              <span className="text-xs text-slate-400">{log.user}</span>
              <span className="text-xs text-slate-400 flex-shrink-0">{log.time}</span>
              {log.type==="alert" && <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ─── SURVEY FORM (formulário público para respondentes) ───────────────────────
function SurveyForm({ onBack }) {
  const SURVEY = { name:"Avaliação de Gestores Q2 2025", category:"360°", anonymous:true };
  const [step,    setStep]   = useState("consent");
  const [current, setCurrent]= useState(0);
  const [answers, setAnswers]= useState({});
  const [starHover,setStarHover]=useState(0);

  const Q = SAMPLE_QUESTIONS;
  const total = Q.length;
  const pct   = Math.round((current / total) * 100);

  const setAns = (id, val) => setAnswers(p => ({...p, [id]: val}));

  const renderQuestion = (q) => {
    const val = answers[q.id];
    if (q.type === "nps") return (
      <div>
        <div className="flex gap-1.5 flex-wrap justify-center mb-3">
          {Array.from({length:11},(_,i) => {
            const color = i<=6?"bg-red-100 text-red-700 border-red-200 hover:bg-red-200":i<=8?"bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200":"bg-green-100 text-green-700 border-green-200 hover:bg-green-200";
            const sel   = val===i?"ring-2 ring-offset-1 ring-purple-500 scale-110":"";
            return (
              <button key={i} onClick={() => setAns(q.id,i)}
                className={`w-12 h-12 rounded-xl border-2 font-bold text-sm transition-all ${color} ${sel}`}>
                {i}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-slate-400 px-1">
          <span>Muito improvável</span><span>Neutro</span><span>Muito provável</span>
        </div>
      </div>
    );
    if (q.type === "scale") return (
      <div className="flex gap-3 justify-center">
        {q.opts.map((opt,i) => (
          <button key={i} onClick={() => setAns(q.id, i)}
            className={`flex-1 py-4 rounded-2xl border-2 text-sm font-medium transition-all ${val===i?"border-purple-500 bg-purple-50 text-purple-700":"border-slate-200 text-slate-600 hover:border-purple-300 hover:bg-purple-50"}`}>
            <div className="text-xl font-bold mb-1">{i+1}</div>
            <div className="text-xs">{opt}</div>
          </button>
        ))}
      </div>
    );
    if (q.type === "rating") return (
      <div className="flex gap-3 justify-center">
        {[1,2,3,4,5].map(i => (
          <button key={i} onMouseEnter={() => setStarHover(i)} onMouseLeave={() => setStarHover(0)}
            onClick={() => setAns(q.id, i)}
            className="transition-transform hover:scale-110">
            <Star size={44} className={`transition-colors ${i<=(starHover||val||0)?"text-amber-400 fill-amber-400":"text-slate-200"}`} />
          </button>
        ))}
      </div>
    );
    if (q.type === "multiple") return (
      <div className="grid grid-cols-2 gap-3">
        {q.opts.map((opt,i) => {
          const sel = Array.isArray(val) && val.includes(i);
          return (
            <button key={i} onClick={() => {
              const cur = Array.isArray(val) ? val : [];
              setAns(q.id, sel ? cur.filter(x=>x!==i) : [...cur, i]);
            }}
            className={`p-4 rounded-2xl border-2 text-sm font-medium text-left transition-all ${sel?"border-purple-500 bg-purple-50 text-purple-700":"border-slate-200 text-slate-600 hover:border-purple-300"}`}>
              <div className={`w-5 h-5 rounded-lg border-2 mb-2 flex items-center justify-center ${sel?"border-purple-500 bg-purple-500":"border-slate-300"}`}>
                {sel && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              {opt}
            </button>
          );
        })}
      </div>
    );
    if (q.type === "text") return (
      <textarea className="w-full border-2 border-slate-200 rounded-2xl px-5 py-4 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-purple-400 resize-none text-sm leading-relaxed"
        placeholder="Digite sua resposta aqui..." rows={5} value={val||""}
        onChange={e => setAns(q.id, e.target.value)} />
    );
    if (q.type === "yesno") return (
      <div className="flex gap-4 justify-center">
        {[["Sim","✅","bg-green-50 border-green-400 text-green-700","green"],["Não","❌","bg-red-50 border-red-400 text-red-700","red"]].map(([lbl,emoji,selCls,_],i) => {
          const selected = (i===0 && val===true) || (i===1 && val===false);
          return (
            <button key={i} onClick={() => setAns(q.id, i===0)}
              className={`w-48 py-8 rounded-2xl border-2 text-lg font-bold transition-all ${selected?selCls:"border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              <div className="text-4xl mb-2">{emoji}</div>{lbl}
            </button>
          );
        })}
      </div>
    );
    return null;
  };

  if (step === "consent") return (
    <div className="p-8 max-w-2xl mx-auto">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
        <ChevronRight size={16} className="rotate-180" />Voltar
      </button>
      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
          <ClipboardList size={28} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">{SURVEY.name}</h1>
        <div className="flex items-center justify-center gap-2 mb-6">
          <LGPDBadge />
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100 flex items-center gap-1"><EyeOff size={10} />Resposta Anônima</span>
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{total} perguntas</span>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-6 text-left">
          <div className="flex items-center gap-2 mb-2"><Shield size={15} className="text-green-600" /><span className="text-sm font-semibold text-green-800">Aviso de Privacidade — LGPD</span></div>
          <p className="text-xs text-green-700 leading-relaxed">
            Suas respostas são <strong>completamente anônimas</strong> e protegidas conforme a Lei nº 13.709/2018 (LGPD). 
            Os dados coletados serão utilizados exclusivamente para fins de avaliação organizacional. 
            Você pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento.
          </p>
        </div>
        <div className="mb-6">
          <label className="flex items-start gap-3 text-left cursor-pointer" onClick={() => setStep("questions")}>
            <div className="w-5 h-5 mt-0.5 rounded border-2 border-green-500 bg-green-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">✓</span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              Li e compreendo o aviso de privacidade. Consinto com a coleta das minhas respostas para a finalidade descrita.
            </p>
          </label>
        </div>
        <button onClick={() => setStep("questions")}
          className="w-full py-4 rounded-2xl text-white font-semibold text-base hover:opacity-90 transition-opacity"
          style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
          Começar Avaliação →
        </button>
      </div>
    </div>
  );

  if (step === "done") return (
    <div className="p-8 max-w-xl mx-auto text-center">
      <div className="bg-white rounded-3xl p-12 border border-slate-100 shadow-sm">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Avaliação concluída!</h2>
        <p className="text-slate-500 mb-6 text-sm leading-relaxed">
          Suas respostas foram registradas com sucesso de forma anônima.<br />
          Obrigado por contribuir para o desenvolvimento da nossa organização.
        </p>
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-center gap-2 text-green-700 text-sm font-medium">
            <Shield size={14} />{total} respostas registradas com proteção LGPD
          </div>
        </div>
        <button onClick={onBack} className="px-8 py-3 text-white rounded-2xl font-medium hover:opacity-90" style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
          Voltar ao início
        </button>
      </div>
    </div>
  );

  const q = Q[current];
  const answered = answers[q.id] !== undefined && answers[q.id] !== "";

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-500">{SURVEY.name}</span>
          <span className="text-xs text-slate-400">{current+1} de {total}</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width:`${((current)/total)*100}%`, background:"linear-gradient(90deg,#5B21B6,#7C3AED)" }} />
        </div>
      </div>

      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm mb-5">
        <div className="flex items-start gap-3 mb-7">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>{current+1}</span>
          <h2 className="text-lg font-semibold text-slate-800 leading-snug">{q.text}</h2>
        </div>
        {renderQuestion(q)}
      </div>

      <div className="flex items-center justify-between">
        <button disabled={current===0} onClick={() => setCurrent(p => p-1)}
          className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm disabled:opacity-40 hover:bg-slate-50">
          <ChevronRight size={15} className="rotate-180" />Anterior
        </button>
        {current < total-1 ? (
          <button disabled={!answered} onClick={() => setCurrent(p => p+1)}
            className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm disabled:opacity-50 hover:opacity-90"
            style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
            Próxima <ChevronRight size={15} />
          </button>
        ) : (
          <button disabled={!answered} onClick={() => setStep("done")}
            className="flex items-center gap-2 px-6 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:opacity-90"
            style={{ background:"linear-gradient(135deg,#059669,#10B981)" }}>
            <CheckCircle size={15} />Enviar Avaliação
          </button>
        )}
      </div>
    </div>
  );
}

// ─── DISTRIBUTION CENTER ───────────────────────────────────────────────────────
function DistributionCenter() {
  const [surveys, setSurveys]         = useState([]);
  const [respondents, setRespondents] = useState([]);
  const [selectedId, setSelectedId]   = useState("");
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [channel, setChannel]         = useState("email"); // email | whatsapp | link
  const [subject, setSubject]         = useState("");
  const [emailBody, setEmailBody]     = useState("");
  const [waBody, setWaBody]           = useState("");
  const [includeEmails, setIncludeEmails] = useState(false);
  const [copied, setCopied]           = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [sv, rp] = await Promise.all([
          api.surveys.list(),
          api.respondents.list().catch(() => ({ respondents: [] })),
        ]);
        const list = sv.surveys || [];
        setSurveys(list);
        setRespondents(rp.respondents || []);
        const pick = list.find(s => s.status === "ativo") || list[0];
        if (pick) setSelectedId(pick.id);
      } catch (e) { setError(e.message || "Erro ao carregar pesquisas."); }
      setLoading(false);
    })();
  }, []);

  const survey   = surveys.find(s => s.id === selectedId);
  const isActive = survey?.status === "ativo";
  const link     = survey?.public_token ? `${window.location.origin}/r/${survey.public_token}` : "";
  const anon     = !!survey?.anonymous;

  const tplEmail = (s, l) => `Olá,\n\nVocê foi convidado(a) a participar da pesquisa "${s?.name || ""}". Sua opinião é muito importante para o desenvolvimento da nossa organização.\n\nResponda aqui (leva poucos minutos):\n${l}\n\n${(s?.anonymous ? "Esta pesquisa é anônima e está" : "Esta pesquisa está")} em conformidade com a LGPD (Lei nº 13.709/2018).\n\nObrigado pela participação.`;
  const tplWa    = (s, l) => `Olá! 👋 Você foi convidado(a) para a pesquisa "${s?.name || ""}". Responda em poucos minutos: ${l}  🔒 Em conformidade com a LGPD.`;

  useEffect(() => {
    if (!survey) return;
    setSubject(`Convite para responder: ${survey.name}`);
    setEmailBody(tplEmail(survey, link));
    setWaBody(tplWa(survey, link));
    setIncludeEmails(false);
  }, [selectedId]); // eslint-disable-line

  const emailRecipients = respondents.filter(r => r.consent_given && r.email && r.email.includes("@")).map(r => r.email);

  const fallbackCopy = (text, id) => { try { const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); setCopied(id); setTimeout(()=>setCopied(""),1500); } catch {} };
  const copy = (text, id) => { try { navigator.clipboard.writeText(text).then(() => { setCopied(id); setTimeout(()=>setCopied(""),1500); }, () => fallbackCopy(text, id)); } catch { fallbackCopy(text, id); } };

  const openEmail = () => {
    const parts = [];
    if (includeEmails && emailRecipients.length) parts.push(`bcc=${encodeURIComponent(emailRecipients.join(","))}`);
    parts.push(`subject=${encodeURIComponent(subject)}`);
    parts.push(`body=${encodeURIComponent(emailBody)}`);
    window.location.href = `mailto:?${parts.join("&")}`;
  };
  const openWa = () => { window.open(`https://wa.me/?text=${encodeURIComponent(waBody)}`, "_blank", "noopener"); };

  const ChannelBtn = ({ id, icon:Icon, label }) => (
    <button onClick={() => setChannel(id)}
      className={`flex-1 py-3 rounded-xl border-2 text-xs font-medium transition-all flex flex-col items-center gap-1 ${channel===id?"border-purple-400 bg-purple-50 text-purple-700":"border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
      <Icon size={18} />{label}
    </button>
  );

  return (
    <div className="p-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-800">Central de Distribuição</h1>
        <p className="text-sm text-slate-500 mt-1">Monte o convite e dispare pelo seu e-mail ou WhatsApp, com o link já preenchido.</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2 mb-5"><AlertTriangle size={15} />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center text-slate-400 text-sm gap-2 py-16"><Loader2 size={18} className="animate-spin" />Carregando...</div>
      ) : surveys.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background:"#F5F3FF" }}><Send size={20} style={{ color:"#7C3AED" }} /></div>
          <h3 className="font-semibold text-slate-800 text-sm">Nenhuma pesquisa para distribuir</h3>
          <p className="text-sm text-slate-500 mt-1">Crie e publique uma pesquisa em “Pesquisas” para gerar o link de distribuição.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm mb-5">
            <label className="text-xs font-medium text-slate-600 block mb-1.5">Pesquisa a distribuir</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
              {surveys.map(s => <option key={s.id} value={s.id}>{s.name} {s.status!=="ativo"?`— ${s.status}`:""}</option>)}
            </select>
            {!isActive && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <AlertTriangle size={13} />Esta pesquisa não está ativa — o link só funciona após publicá-la em “Pesquisas”.
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>{respondents.length} respondente(s) cadastrado(s)</span>
              <span>·</span>
              <span>{emailRecipients.length} com e-mail e consentimento</span>
            </div>
          </div>

          {/* Link sempre visível */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm mb-5">
            <div className="flex items-center gap-2 mb-2"><Link2 size={16} style={{ color:"#5B21B6" }} /><h3 className="font-semibold text-slate-800 text-sm">Link público</h3></div>
            {link ? (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                <span className="text-xs text-slate-600 truncate flex-1">{link}</span>
                <button onClick={() => copy(link, "link")} className="text-xs font-semibold flex-shrink-0 px-2 py-1 rounded-lg hover:bg-slate-100" style={{ color:"#5B21B6" }}>{copied==="link"?"Copiado!":"Copiar"}</button>
              </div>
            ) : <p className="text-xs text-slate-400">Publique a pesquisa para gerar o link.</p>}
          </div>

          <div className="flex gap-2 mb-5">
            <ChannelBtn id="email" icon={Mail} label="E-mail" />
            <ChannelBtn id="whatsapp" icon={MessageCircle} label="WhatsApp" />
            <ChannelBtn id="link" icon={Link2} label="Só o link" />
          </div>

          {channel === "email" && (
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <h3 className="font-semibold text-slate-800 text-sm mb-4">Mensagem de e-mail</h3>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Assunto</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-purple-200" />
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Corpo da mensagem</label>
              <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={9} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-200" style={{ resize:"vertical" }} />
              <label className={`flex items-center gap-2.5 mt-3 py-2 px-3 rounded-xl cursor-pointer ${emailRecipients.length?"bg-slate-50 hover:bg-slate-100":"bg-slate-50 opacity-60"}`}>
                <input type="checkbox" disabled={emailRecipients.length===0} checked={includeEmails} onChange={e => setIncludeEmails(e.target.checked)} className="w-4 h-4 accent-purple-600" />
                <span className="text-sm text-slate-700">Preencher destinatários em cópia oculta (Cco) — {emailRecipients.length} respondente(s) com consentimento</span>
              </label>
              <div className="flex gap-2 mt-4">
                <button onClick={openEmail} className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm hover:opacity-90" style={{ background:GRAD }}><Send size={14} />Abrir no meu e-mail</button>
                <button onClick={() => copy(emailBody, "ebody")} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50"><FileText size={14} />{copied==="ebody"?"Copiado!":"Copiar mensagem"}</button>
              </div>
              <p className="text-xs text-slate-400 mt-3">Abre o seu programa de e-mail com tudo preenchido — você confere e envia. Para listas grandes, prefira “Copiar mensagem” e colar, ou distribuir só o link.</p>
            </div>
          )}

          {channel === "whatsapp" && (
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <h3 className="font-semibold text-slate-800 text-sm mb-4">Mensagem de WhatsApp</h3>
              <textarea value={waBody} onChange={e => setWaBody(e.target.value)} rows={5} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-200" style={{ resize:"vertical" }} />
              <div className="flex gap-2 mt-4">
                <button onClick={openWa} className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm hover:opacity-90" style={{ background:"linear-gradient(135deg,#059669,#10B981)" }}><MessageCircle size={14} />Abrir no WhatsApp</button>
                <button onClick={() => copy(waBody, "wabody")} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50"><FileText size={14} />{copied==="wabody"?"Copiado!":"Copiar mensagem"}</button>
              </div>
              <p className="text-xs text-slate-400 mt-3">Abre o WhatsApp com a mensagem pronta — você escolhe o contato ou grupo e envia.</p>
            </div>
          )}

          {channel === "link" && (
            <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm text-center">
              <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-4"><Link2 size={28} style={{ color:"#5B21B6" }} /></div>
              <p className="text-sm font-semibold text-slate-800 mb-3">Copie o link e distribua onde quiser</p>
              {link ? (
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 max-w-md mx-auto">
                  <span className="text-xs text-slate-600 truncate flex-1 text-left">{link}</span>
                  <button onClick={() => copy(link, "link2")} className="text-xs font-semibold flex-shrink-0" style={{ color:"#5B21B6" }}>{copied==="link2"?"Copiado!":"Copiar"}</button>
                </div>
              ) : <p className="text-xs text-slate-400">Publique a pesquisa para gerar o link.</p>}
              <p className="text-xs text-slate-400 mt-3">Intranet, mural, e-mail, grupo de mensagens — o link leva direto à pesquisa.</p>
            </div>
          )}

          <div className="rounded-2xl p-4 border border-green-100 flex items-center gap-2 text-xs text-green-700 mt-5" style={{ background:"#F0FDF4" }}>
            <Shield size={14} />
            {anon ? "Esta pesquisa é anônima. " : ""}As respostas são tratadas conforme a LGPD. Envie convites apenas a quem deu consentimento.
          </div>
        </>
      )}
    </div>
  );
}

// ─── AI INSIGHTS ──────────────────────────────────────────────────────────────
function AIInsights() {
  const [surveys,     setSurveys]     = useState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loading,     setLoading]     = useState(false);
  const [insights,    setInsights]    = useState(null);
  const [error,       setError]       = useState("");

  useEffect(() => {
    (async () => {
      try {
        const sv = await api.surveys.list();
        const list = sv.surveys || [];
        setSurveys(list);
        const pick = list.find(s => (s.response_count||0) > 0) || list[0];
        if (pick) setSelectedId(pick.id);
      } catch (e) { setError(e.message || "Erro ao carregar pesquisas."); }
      setLoadingList(false);
    })();
  }, []);

  const selected = surveys.find(s => s.id === selectedId) || null;

  const generateInsights = async () => {
    if (!selectedId) return;
    setLoading(true); setInsights(null); setError("");
    try {
      const data = await api.results.insights(selectedId);
      setInsights(data.insights);
    } catch (e) {
      setError(e.message || "Erro ao gerar a análise. Tente novamente.");
    }
    setLoading(false);
  };

  return (
    <div className="p-8">
      <div className="mb-7">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Insights com IA</h1>
            <p className="text-sm text-slate-500">Análise inteligente dos resultados com recomendações estratégicas para RH.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm mb-6">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-3">Selecione a pesquisa para analisar</label>
        {loadingList ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-3"><Loader2 size={16} className="animate-spin" />Carregando pesquisas...</div>
        ) : surveys.length === 0 ? (
          <div className="text-slate-400 text-sm py-3">Nenhuma pesquisa criada ainda.</div>
        ) : (
          <>
          <div className="flex gap-2 flex-wrap mb-4">
            {surveys.map(s => (
              <button key={s.id} onClick={() => { setSelectedId(s.id); setInsights(null); }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${selectedId===s.id?"text-white":"border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                style={selectedId===s.id?{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }:{}}>
                {s.name}
              </button>
            ))}
          </div>
          {selected && (
            <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl mb-4">
              {[["Respostas",String(selected.response_count||0)],["Categoria",selected.category||"—"],["Status",selected.status||"—"]].map(([lbl,val],i) => (
                <div key={i} className={`flex-1 text-center ${i<2?"border-r border-slate-200":""}`}>
                  <div className="text-sm font-bold text-slate-800">{val}</div>
                  <div className="text-xs text-slate-400">{lbl}</div>
                </div>
              ))}
            </div>
          )}
          </>
        )}
        <button onClick={generateInsights} disabled={loading || !selectedId}
          className="w-full py-3 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90"
          style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
          {loading ? <><Loader2 size={16} className="animate-spin" />Analisando com IA...</> : <><Sparkles size={16} />Gerar Análise Completa</>}
        </button>
        {error && <p className="text-xs text-red-500 mt-2 text-center">{error}</p>}
      </div>

      {loading && (
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_,i) => (
            <div key={i} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm animate-pulse">
              <div className="h-4 bg-slate-100 rounded w-1/3 mb-3" /><div className="h-3 bg-slate-100 rounded w-full mb-2" /><div className="h-3 bg-slate-100 rounded w-4/5" />
            </div>
          ))}
        </div>
      )}

      {insights && !loading && (
        <div className="space-y-5">
          {/* Resumo */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                <FileCheck size={16} style={{ color:"#5B21B6" }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-slate-800 text-sm">Resumo Executivo</h3>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${insights.npsClassificacao==="Excelente"?"bg-green-100 text-green-700":insights.npsClassificacao==="Bom"?"bg-blue-100 text-blue-700":"bg-amber-100 text-amber-700"}`}>
                    NPS {insights.npsClassificacao}
                  </span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{insights.resumo}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* Pontos fortes */}
            <div className="bg-white rounded-2xl p-5 border border-green-100 shadow-sm">
              <h3 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />Pontos Fortes
              </h3>
              <div className="space-y-2">
                {(insights.pontosFortesArr||[]).map((p,i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3 bg-green-50 rounded-xl">
                    <CheckCircle size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-slate-700 leading-relaxed">{p}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Pontos de atenção */}
            <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
              <h3 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />Pontos de Atenção
              </h3>
              <div className="space-y-2">
                {(insights.pontosAtencaoArr||[]).map((p,i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3 bg-amber-50 rounded-xl">
                    <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-slate-700 leading-relaxed">{p}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recomendações */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <h3 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
              <Zap size={15} style={{ color:"#5B21B6" }} />Recomendações Estratégicas
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {(insights.recomendacoesArr||[]).map((r,i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-purple-50 rounded-xl border border-purple-100">
                  <span className="w-6 h-6 rounded-lg text-white text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>{i+1}</span>
                  <p className="text-xs text-slate-700 leading-relaxed">{r}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* Temas */}
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <h3 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
                <MessageCircle size={15} className="text-blue-500" />Principais Temas (Respostas Abertas)
              </h3>
              <div className="space-y-2">
                {(insights.temasAbertosArr||[]).map((t,i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl">
                    <span className="text-xs font-bold text-blue-600 w-5 text-center">{i+1}</span>
                    <span className="text-xs text-slate-700">{t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Prioridade + Benchmark */}
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                <h3 className="font-semibold text-red-800 text-sm mb-2 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-red-500" />Prioridade Imediata
                </h3>
                <p className="text-xs text-red-700 leading-relaxed">{insights.prioridadeImediata}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                <h3 className="font-semibold text-blue-800 text-sm mb-2 flex items-center gap-2">
                  <BarChart2 size={14} className="text-blue-500" />Benchmark de Mercado
                </h3>
                <p className="text-xs text-blue-700 leading-relaxed">{insights.benchmarkTexto}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── NOTIFICATION CENTER ──────────────────────────────────────────────────────
function NotificationCenter({ notifications, setNotifications }) {
  const [filter, setFilter] = useState("todas");
  const unread = notifications.filter(n => !n.read).length;

  const typeIcon = {
    response:{ icon:"💬", bg:"bg-blue-100",   label:"Resposta"   },
    alert:   { icon:"⚠️", bg:"bg-amber-100",  label:"Alerta"     },
    ai:      { icon:"✨", bg:"bg-purple-100",  label:"IA"         },
    deadline:{ icon:"⏰", bg:"bg-red-100",     label:"Prazo"      },
    success: { icon:"✅", bg:"bg-green-100",   label:"Sucesso"    },
    security:{ icon:"🔒", bg:"bg-slate-100",   label:"Segurança"  },
  };

  const filtered = notifications.filter(n => {
    if (filter === "nao_lidas") return !n.read;
    if (filter === "alertas")   return n.type === "alert" || n.type === "security";
    return true;
  });

  const markAllRead = () => setNotifications(p => p.map(n => ({...n, read:true})));
  const markRead    = id  => setNotifications(p => p.map(n => n.id===id ? {...n,read:true} : n));

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Notificações</h1>
          <p className="text-sm text-slate-500 mt-1">{unread > 0 ? `${unread} notificação${unread>1?"s":""} não lida${unread>1?"s":""}` : "Todas as notificações em dia ✓"}</p>
        </div>
        {unread > 0 && (
          <button onClick={markAllRead} className="flex items-center gap-2 px-4 py-2 text-sm border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50">
            <CheckCircle size={14} />Marcar todas como lidas
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-5">
        {[["todas","Todas"],["nao_lidas",`Não lidas (${unread})`],["alertas","Alertas"]].map(([id,label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter===id?"text-white":"bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            style={filter===id?{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }:{}}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map(n => {
          const t = typeIcon[n.type] || typeIcon.success;
          return (
            <div key={n.id} onClick={() => markRead(n.id)}
              className={`flex items-start gap-4 p-4 rounded-2xl border cursor-pointer transition-all hover:shadow-sm ${n.read?"bg-white border-slate-100":"bg-purple-50 border-purple-100"}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${t.bg}`}>{t.icon}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-relaxed ${n.read?"text-slate-600":"text-slate-800 font-medium"}`}>{n.text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-400">{n.time} atrás</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.bg} text-slate-600`}>{t.label}</span>
                </div>
              </div>
              {!n.read && <span className="w-2.5 h-2.5 rounded-full bg-purple-500 mt-1 flex-shrink-0" />}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-3">🔔</div>
            <p className="text-sm font-medium">Nenhuma notificação encontrada</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TEAM MANAGEMENT ──────────────────────────────────────────────────────────
function TeamManagement() {
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newName,  setNewName]  = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole,  setNewRole]  = useState("viewer");
  const [saving,   setSaving]   = useState(false);
  const [tempPw,   setTempPw]   = useState(null);   // senha temporária a exibir após criar
  const [tempName, setTempName] = useState("");
  const [copied,   setCopied]   = useState(false);

  const roleConfig = {
    admin:   { label:"Administrador", bg:"bg-purple-100 text-purple-700" },
    manager: { label:"Gestor",        bg:"bg-blue-100 text-blue-700"     },
    viewer:  { label:"Colaborador",   bg:"bg-slate-100 text-slate-600"   },
  };

  const PERMISSIONS = [
    ["Criar pesquisas",         true,  true,  false],
    ["Editar pesquisas",        true,  true,  false],
    ["Excluir pesquisas",       true,  false, false],
    ["Ver resultados",          true,  true,  true ],
    ["Exportar relatórios",     true,  true,  false],
    ["Gerenciar respondentes",  true,  true,  false],
    ["Gerenciar equipe",        true,  false, false],
    ["Configurações LGPD",      true,  false, false],
    ["Usar IA",                 true,  true,  false],
    ["Responder avaliações",    true,  true,  true ],
  ];

  async function loadUsers() {
    setLoading(true); setError("");
    try {
      const data = await api.users.list();
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message || "Não foi possível carregar os usuários.");
    }
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleCreate() {
    if (!newName || !newEmail) { setError("Preencha nome e e-mail."); return; }
    setSaving(true); setError(""); setTempPw(null);
    try {
      const data = await api.users.create({ name:newName, email:newEmail, role:newRole });
      if (data.temporaryPassword) { setTempPw(data.temporaryPassword); setTempName(newName); }
      setNewName(""); setNewEmail(""); setNewRole("viewer"); setShowForm(false);
      await loadUsers();
    } catch (e) {
      setError(e.message || "Erro ao criar usuário.");
    }
    setSaving(false);
  }

  async function handleRoleChange(id, role) {
    try { await api.users.update(id, { role }); await loadUsers(); }
    catch (e) { setError(e.message || "Erro ao alterar papel."); }
  }

  async function handleDeactivate(id, name) {
    if (!window.confirm(`Desativar o acesso de "${name}"? A pessoa não poderá mais entrar no sistema.`)) return;
    try { await api.users.remove(id); await loadUsers(); }
    catch (e) { setError(e.message || "Erro ao desativar usuário."); }
  }

  function copyPw() {
    try { navigator.clipboard.writeText(tempPw); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {}
  }

  const fmtDate = (d) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
    catch { return d; }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Equipe & Acesso</h1>
          <p className="text-sm text-slate-500 mt-1">Cadastre colaboradores e defina o papel de cada um. As credenciais são enviadas pelo RH.</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setTempPw(null); setError(""); }}
          className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90"
          style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
          <Plus size={15} />Cadastrar Usuário
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-5 flex items-center gap-2">
          <AlertTriangle size={15} />{error}
        </div>
      )}

      {/* Senha temporária recém-gerada */}
      {tempPw && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <CheckCircle size={18} className="text-green-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-800 text-sm">Usuário "{tempName}" criado com sucesso</h3>
              <p className="text-xs text-green-700 mt-1 mb-3">Compartilhe esta senha temporária com a pessoa para o primeiro acesso. Ela aparece apenas uma vez.</p>
              <div className="flex items-center gap-2">
                <code className="bg-white border border-green-300 rounded-lg px-3 py-2 text-sm font-mono text-green-800 flex-1">{tempPw}</code>
                <button onClick={copyPw} className="px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700">
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
            </div>
            <button onClick={() => setTempPw(null)} className="text-green-400 hover:text-green-600"><X size={16} /></button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-slate-800 text-sm mb-4">Cadastrar novo usuário</h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Nome</label>
              <input className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-400 bg-white"
                placeholder="Nome completo" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 block mb-1">E-mail corporativo</label>
              <input className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-400 bg-white"
                placeholder="nome@rgis.com.br" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Papel</label>
              <select className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none bg-white" value={newRole} onChange={e => setNewRole(e.target.value)}>
                <option value="admin">Administrador</option>
                <option value="manager">Gestor</option>
                <option value="viewer">Colaborador</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-2 text-white text-sm rounded-xl font-medium hover:opacity-90 disabled:opacity-60" style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
              {saving ? <><Loader2 size={13} className="inline mr-1.5 animate-spin" />Criando...</> : <><Plus size={13} className="inline mr-1.5" />Criar usuário</>}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-white">Cancelar</button>
          </div>
          <p className="text-xs text-slate-400 mt-2">Uma senha temporária será gerada automaticamente para o primeiro acesso.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 mb-6">
        {/* Users table */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-sm">Usuários {loading ? "" : `(${users.length})`}</h3>
            {!loading && <button onClick={loadUsers} className="text-xs text-purple-600 font-medium hover:opacity-80">Atualizar</button>}
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
              <Loader2 size={18} className="animate-spin" />Carregando usuários...
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">Nenhum usuário cadastrado ainda.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {users.map(u => {
                const r = roleConfig[u.role] || roleConfig.viewer;
                return (
                  <div key={u.id} className="flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors">
                    <div className="w-9 h-9 rounded-full text-white text-sm font-bold flex items-center justify-center flex-shrink-0"
                      style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
                      {(u.name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800 truncate">{u.name}</span>
                        {!u.active && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">Inativo</span>}
                      </div>
                      <div className="text-xs text-slate-400 truncate">{u.email}</div>
                      <div className="text-xs text-slate-400">Último acesso: {fmtDate(u.last_login)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}
                        className={`text-xs font-semibold px-2 py-1 rounded-lg border-0 cursor-pointer ${r.bg}`}>
                        <option value="admin">Administrador</option>
                        <option value="manager">Gestor</option>
                        <option value="viewer">Colaborador</option>
                      </select>
                      {u.active && (
                        <button onClick={() => handleDeactivate(u.id, u.name)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Desativar acesso">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Permission matrix */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800 text-sm">Matriz de Permissões</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-500 px-5 py-3">Ação</th>
                  <th className="text-center text-xs font-semibold text-purple-600 px-3 py-3">Admin</th>
                  <th className="text-center text-xs font-semibold text-blue-600 px-3 py-3">Gestor</th>
                  <th className="text-center text-xs font-semibold text-slate-500 px-3 py-3">Colab.</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map(([action, adm, mgr, viw], i) => (
                  <tr key={i} className={`${i<PERMISSIONS.length-1?"border-b border-slate-50":""} hover:bg-slate-50`}>
                    <td className="px-5 py-2.5 text-xs text-slate-700">{action}</td>
                    {[adm, mgr, viw].map((ok, j) => (
                      <td key={j} className="px-3 py-2.5 text-center">
                        {ok
                          ? <CheckCircle size={14} className="text-green-500 mx-auto" />
                          : <X size={14} className="text-slate-300 mx-auto" />
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── TEMPLATES LIBRARY ────────────────────────────────────────────────────────
function TemplatesLibrary({ onUseTemplate }) {
  const [search,   setSearch]   = useState("");
  const [category, setCategory] = useState("Todos");

  const cats = ["Todos", ...Array.from(new Set(MOCK_TEMPLATES.map(t => t.category)))];

  const filtered = MOCK_TEMPLATES.filter(t => {
    const ms = t.name.toLowerCase().includes(search.toLowerCase()) || t.tags.some(g => g.toLowerCase().includes(search.toLowerCase()));
    const mc = category === "Todos" || t.category === category;
    return ms && mc;
  });

  const catColors = {
    "360°":"bg-purple-100 text-purple-700", "NPS":"bg-blue-100 text-blue-700",
    "Clima":"bg-teal-100 text-teal-700", "Fornecedores":"bg-amber-100 text-amber-700",
    "Integração":"bg-green-100 text-green-700", "Turnover":"bg-red-100 text-red-700",
    "T&D":"bg-indigo-100 text-indigo-700", "Pulso":"bg-pink-100 text-pink-700",
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Biblioteca de Templates</h1>
          <p className="text-sm text-slate-500 mt-1">Pesquisas prontas e validadas, conformes com a LGPD. Use e personalize.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-purple-400"
            placeholder="Buscar template ou tag..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {cats.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-all ${category===c?"text-white":"bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              style={category===c?{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }:{}}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {filtered.map(t => (
          <div key={t.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-slate-800 text-sm">{t.name}</h3>
                  <LGPDBadge />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catColors[t.category]||"bg-slate-100 text-slate-600"}`}>{t.category}</span>
                  <span className="text-xs text-slate-400">{t.questions} perguntas</span>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 justify-end mb-0.5">
                  {[...Array(5)].map((_,i) => (
                    <Star key={i} size={11} className={i < Math.floor(t.rating) ? "text-amber-400 fill-amber-400":"text-slate-200"} />
                  ))}
                </div>
                <div className="text-xs text-slate-400">{t.uses} usos</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-4">
              {t.tags.map((tag,i) => (
                <span key={i} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
            <div className="flex gap-2 pt-3 border-t border-slate-50">
              <button disabled title="Recurso em desenvolvimento" className="flex-1 py-2 text-xs border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
                <Eye size={11} />Visualizar
              </button>
              <button onClick={() => onUseTemplate && onUseTemplate(t)}
                className="flex-1 py-2 text-xs text-white rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-1"
                style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
                <Plus size={11} />Usar Template
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ADVANCED REPORTS ──────────────────────────────────────────────────────────
function AdvancedReports() {
  const [view, setView]               = useState("comparativo"); // comparativo | participacao
  const [surveys, setSurveys]         = useState([]);
  const [reports, setReports]         = useState({});            // surveyId -> { nps, completion, responses }
  const [respondents, setRespondents] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [sv, rp] = await Promise.all([
          api.surveys.list(),
          api.respondents.list().catch(() => ({ respondents: [] })),
        ]);
        const list = sv.surveys || [];
        setSurveys(list);
        setRespondents(rp.respondents || []);
        const withResp = list.filter(s => (s.response_count || 0) > 0);
        const results = await Promise.all(
          withResp.map(s => api.get(`/results/${s.id}`).then(r => ({ id:s.id, r })).catch(() => null))
        );
        const map = {};
        results.forEach(x => { if (x) map[x.id] = { nps:(x.r.overallNPS ? x.r.overallNPS.nps : null), completion:x.r.completionRate, responses:x.r.survey?.totalResponses }; });
        setReports(map);
      } catch (e) { setError(e.message || "Erro ao carregar relatórios."); }
      setLoading(false);
    })();
  }, []);

  const totalSurveys   = surveys.length;
  const activeSurveys  = surveys.filter(s => s.status === "ativo").length;
  const totalResponses = surveys.reduce((a, s) => a + (s.response_count || 0), 0);
  const npsVals  = Object.values(reports).map(r => r.nps).filter(v => v != null);
  const avgNps   = npsVals.length ? Math.round(npsVals.reduce((a,b)=>a+b,0)/npsVals.length) : null;
  const compVals = Object.values(reports).map(r => r.completion).filter(v => v != null);
  const avgComp  = compVals.length ? Math.round(compVals.reduce((a,b)=>a+b,0)/compVals.length) : null;

  const totalResp  = respondents.length;
  const consented  = respondents.filter(r => r.consent_given).length;
  const consentPct = totalResp ? Math.round(consented/totalResp*100) : 0;
  const GROUPS = [["gestores","Gestores"],["fornecedores","Fornecedores"],["subordinados","Subordinados"]];
  const byGroup = GROUPS.map(([key,label]) => ({ key, label, count: respondents.filter(r => r.group_type === key).length }));
  const otherCount = respondents.filter(r => !GROUPS.some(([k]) => k === r.group_type)).length;
  const maxGroup = Math.max(1, ...byGroup.map(g => g.count), otherCount);

  const compRows = surveys.map(s => {
    const r = reports[s.id] || {};
    return { id:s.id, name:s.name, status:s.status, responses: s.response_count||0, completion: r.completion, nps: r.nps };
  });
  const chartData = compRows.filter(r => r.responses > 0).map(r => ({ name: r.name.length>16 ? r.name.slice(0,15)+"…" : r.name, Respostas: r.responses }));
  const npsColor = (n) => n==null ? "text-slate-300" : n>=50 ? "text-green-600" : n>=0 ? "text-blue-600" : "text-red-500";

  const exportComparativo = () => {
    const rows = [["Pesquisa","Status","Respostas","Conclusão %","NPS"]];
    compRows.forEach(r => rows.push([r.name, r.status, r.responses, r.completion==null?"":r.completion, r.nps==null?"":r.nps]));
    downloadCSV(`relatorio-comparativo-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };
  const exportParticipacao = () => {
    const rows = [["Grupo","Respondentes"]];
    byGroup.forEach(g => rows.push([g.label, g.count]));
    if (otherCount) rows.push(["Outros", otherCount]);
    rows.push(["", ""]);
    rows.push(["Total de respondentes ativos", totalResp]);
    rows.push(["Com consentimento LGPD", consented]);
    rows.push(["% de consentimento", consentPct + "%"]);
    downloadCSV(`relatorio-participacao-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  const Kpi = ({ label, value, sub, color }) => (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color: color || "#1E293B" }}>{value}</div>
      {sub ? <div className="text-xs text-slate-400 mt-0.5">{sub}</div> : null}
    </div>
  );
  const Tab = ({ id, children }) => (
    <button onClick={() => setView(id)}
      className={`px-4 py-2 text-sm rounded-xl ${view===id ? "text-white" : "text-slate-600 hover:bg-slate-50 border border-slate-200"}`}
      style={view===id ? { background:GRAD } : {}}>{children}</button>
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Relatórios Avançados</h1>
          <p className="text-sm text-slate-500 mt-1">Visão consolidada das pesquisas e da participação, com proteção LGPD.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => (view==="comparativo" ? exportComparativo() : exportParticipacao())} disabled={loading || (view==="comparativo" ? compRows.length===0 : totalResp===0)}
            title="Baixar este relatório em CSV" className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={14} />Exportar CSV
          </button>
          <button onClick={() => window.print()} title="Abrir a janela de impressão (salve como PDF)" className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50">
            <FileText size={14} />Exportar PDF
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2 mb-5"><AlertTriangle size={15} />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center text-slate-400 text-sm gap-2 py-16"><Loader2 size={18} className="animate-spin" />Carregando relatórios...</div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Kpi label="Pesquisas" value={totalSurveys} sub={`${activeSurveys} ativa${activeSurveys!==1?"s":""}`} />
            <Kpi label="Total de respostas" value={totalResponses} color="#5B21B6" />
            <Kpi label="NPS médio" value={avgNps==null ? "—" : avgNps} sub={npsVals.length ? `de ${npsVals.length} pesquisa(s)` : "sem dados"} />
            <Kpi label="Conclusão média" value={avgComp==null ? "—" : `${avgComp}%`} sub={compVals.length ? `de ${compVals.length} pesquisa(s)` : "sem dados"} />
          </div>

          <div className="flex gap-2 mb-5">
            <Tab id="comparativo">Comparativo de pesquisas</Tab>
            <Tab id="participacao">Participação &amp; LGPD</Tab>
          </div>

          {view === "comparativo" && (
            <>
              {chartData.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-6">
                  <h3 className="font-semibold text-slate-800 text-sm mb-4">Respostas por pesquisa</h3>
                  <div style={{ width:"100%", height:280 }}>
                    <ResponsiveContainer>
                      <BarChart data={chartData} margin={{ top:5, right:10, left:-10, bottom:5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis dataKey="name" tick={{ fontSize:11, fill:"#94A3B8" }} interval={0} angle={-15} textAnchor="end" height={50} />
                        <YAxis tick={{ fontSize:11, fill:"#94A3B8" }} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="Respostas" fill="#7C3AED" radius={[6,6,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100"><h3 className="font-semibold text-slate-800 text-sm">Comparativo por pesquisa</h3></div>
                {compRows.length === 0 ? (
                  <div className="px-6 py-8 text-center text-sm text-slate-400">Nenhuma pesquisa cadastrada ainda.</div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        {["Pesquisa","Status","Respostas","Conclusão","NPS"].map(h => (
                          <th key={h} className={`text-xs font-semibold text-slate-500 px-5 py-3 ${h==="Pesquisa"?"text-left":"text-center"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compRows.map((r,i) => (
                        <tr key={r.id} className={`hover:bg-slate-50 transition-colors ${i<compRows.length-1?"border-b border-slate-50":""}`}>
                          <td className="px-5 py-3.5 text-sm font-medium text-slate-800">{r.name}</td>
                          <td className="px-5 py-3.5 text-center"><Badge status={r.status} /></td>
                          <td className="px-5 py-3.5 text-center text-sm text-slate-700">{r.responses}</td>
                          <td className="px-5 py-3.5 text-center text-sm text-slate-700">{r.completion==null?"—":`${r.completion}%`}</td>
                          <td className={`px-5 py-3.5 text-center text-sm font-bold ${npsColor(r.nps)}`}>{r.nps==null?"—":r.nps}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {view === "participacao" && (
            <>
              <div className="grid grid-cols-3 gap-5 mb-6">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 col-span-2">
                  <h3 className="font-semibold text-slate-800 text-sm mb-4">Respondentes por grupo</h3>
                  {totalResp === 0 ? (
                    <p className="text-sm text-slate-400">Nenhum respondente ativo cadastrado.</p>
                  ) : (
                    <div className="space-y-3">
                      {byGroup.map(g => (
                        <div key={g.key}>
                          <div className="flex justify-between text-xs text-slate-600 mb-1"><span>{g.label}</span><span className="font-semibold">{g.count}</span></div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${Math.round(g.count/maxGroup*100)}%`, background:GRAD }} /></div>
                        </div>
                      ))}
                      {otherCount > 0 && (
                        <div>
                          <div className="flex justify-between text-xs text-slate-600 mb-1"><span>Outros</span><span className="font-semibold">{otherCount}</span></div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-slate-300" style={{ width:`${Math.round(otherCount/maxGroup*100)}%` }} /></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3"><Shield size={16} className="text-green-600" /><h3 className="font-semibold text-slate-800 text-sm">Consentimento LGPD</h3></div>
                  <div className="text-3xl font-bold text-slate-800">{consentPct}%</div>
                  <p className="text-xs text-slate-400 mt-1 mb-3">{consented} de {totalResp} respondente(s) com consentimento registrado</p>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${consentPct}%`, background:"linear-gradient(90deg,#059669,#10B981)" }} /></div>
                  {consented < totalResp && <p className="text-xs text-amber-600 mt-3">{totalResp - consented} respondente(s) ainda sem consentimento. Registre em “Respondentes”.</p>}
                </div>
              </div>

              <div className="rounded-2xl p-4 border border-purple-100 flex items-center gap-2 text-xs text-purple-700" style={{ background:"linear-gradient(135deg,#f5f3ff,#ede9fe)" }}>
                <Info size={14} />
                Respondentes anonimizados (direito ao esquecimento) não entram nesta contagem, conforme a LGPD.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── SETTINGS PAGE ─────────────────────────────────────────────────────────────
function ChangePasswordCard() {
  const [cur,     setCur]     = useState("");
  const [nw,      setNw]      = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState(null);   // {type:'ok'|'err', text}

  async function submit() {
    setMsg(null);
    if (!cur || !nw)            { setMsg({ type:"err", text:"Preencha a senha atual e a nova." }); return; }
    if (nw.length < 8)          { setMsg({ type:"err", text:"A nova senha deve ter no mínimo 8 caracteres." }); return; }
    if (nw !== confirm)         { setMsg({ type:"err", text:"A confirmação não confere com a nova senha." }); return; }
    if (nw === cur)             { setMsg({ type:"err", text:"A nova senha deve ser diferente da atual." }); return; }
    setSaving(true);
    try {
      await api.auth.changePassword(cur, nw);
      setMsg({ type:"ok", text:"Senha alterada com sucesso!" });
      setCur(""); setNw(""); setConfirm("");
    } catch (e) {
      setMsg({ type:"err", text:e.message || "Erro ao alterar a senha." });
    }
    setSaving(false);
  }

  const field = (label, val, set, ph) => (
    <div>
      <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      <input type="password" value={val} onChange={e => set(e.target.value)} placeholder={ph}
        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-400 bg-white" />
    </div>
  );

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm mb-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
          <Key size={18} style={{ color:"#5B21B6" }} />
        </div>
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">Trocar Senha</h3>
          <p className="text-xs text-slate-400 mt-0.5">Altere a senha da sua conta. Você será desconectado das outras sessões.</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {field("Senha atual", cur, setCur, "Sua senha atual")}
        {field("Nova senha", nw, setNw, "Mínimo 8 caracteres")}
        {field("Confirmar nova senha", confirm, setConfirm, "Repita a nova senha")}
      </div>
      {msg && (
        <div className={`mt-3 text-sm rounded-xl px-4 py-2.5 flex items-center gap-2 ${msg.type==="ok"?"bg-green-50 border border-green-200 text-green-700":"bg-red-50 border border-red-200 text-red-700"}`}>
          {msg.type==="ok" ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}{msg.text}
        </div>
      )}
      <div className="mt-3">
        <button onClick={submit} disabled={saving}
          className="px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-60 flex items-center gap-2"
          style={{ background:"linear-gradient(135deg,#5B21B6,#7C3AED)" }}>
          {saving ? <><Loader2 size={14} className="animate-spin" />Salvando...</> : <><Key size={14} />Alterar senha</>}
        </button>
      </div>
    </div>
  );
}

function SettingsPage() {
  const items = [
    { title:"Perfil da Empresa",   desc:"Nome, logo e dados da organização",          Icon:Building2  },
    { title:"Integrações",         desc:"WhatsApp, e-mail SMTP, APIs externas",       Icon:Link2      },
    { title:"Notificações",        desc:"Alertas automáticos e lembretes",            Icon:Bell       },
    { title:"Equipe & Acesso",     desc:"Usuários, permissões e papéis",              Icon:Users      },
    { title:"Marca & Aparência",   desc:"Cores, logo e personalização da plataforma", Icon:Eye        },
    { title:"Exportação de Dados", desc:"Formatos, criptografia e agendamento",       Icon:Download   },
  ];

  return (
    <div className="p-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-800">Configurações</h1>
        <p className="text-sm text-slate-500 mt-1">Gerencie as preferências da plataforma RH Survey.</p>
      </div>
      <ChangePasswordCard />
      <div className="grid grid-cols-2 gap-4">
        {items.map(({ title,desc,Icon },i) => (
          <div key={i} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-start gap-4 hover:shadow-md transition-all cursor-pointer group">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-100 transition-colors">
              <Icon size={18} style={{ color:"#5B21B6" }} />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
            </div>
            <ChevronRight size={15} className="text-slate-300 mt-0.5 group-hover:text-slate-400 transition-colors" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
const PAGE_LABELS = {
  dashboard:"Dashboard", surveys:"Pesquisas", respondents:"Respondentes",
  evaluation360:"Avaliação 360°", results:"Resultados",
  formulario:"Formulário de Resposta", distribuicao:"Central de Distribuição",
  templates:"Biblioteca de Templates", relatorios:"Relatórios Avançados",
  equipe:"Equipe & Acesso", notificacoes:"Notificações",
  insights:"Insights com IA",
  lgpd:"LGPD & Privacidade", security:"Segurança", settings:"Configurações",
};

export default function RHSurvey() {
  const [page,     setPage]    = useState("dashboard");
  const [creating, setCreating]= useState(false);
  const [lgpdOk,       setLgpdOk]       = useState(false);
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleNav = p => { setCreating(false); setPage(p); };

  const renderContent = () => {
    if (creating) return <SurveyBuilder onBack={() => setCreating(false)} />;
    switch (page) {
      case "dashboard":     return <Dashboard     setPage={handleNav} />;
      case "surveys":       return <SurveyList    onCreateNew={() => setCreating(true)} onView={() => handleNav("results")} />;
      case "respondents":   return <RespondentManager />;
      case "evaluation360": return <Evaluation360 />;
      case "results":       return <ResultsDashboard />;
      case "formulario":    return <SurveyForm    onBack={() => handleNav("surveys")} />;
      case "templates":     return <TemplatesLibrary onUseTemplate={() => setCreating(true)} />;
      case "relatorios":    return <AdvancedReports />;
      case "equipe":        return <TeamManagement />;
      case "notificacoes":  return <NotificationCenter notifications={notifications} setNotifications={setNotifications} />;
      case "distribuicao":  return <DistributionCenter />;
      case "insights":      return <AIInsights />;
      case "lgpd":          return <LGPDPage />;
      case "security":      return <SecurityPage />;
      case "settings":      return <SettingsPage />;
      default:              return <Dashboard setPage={handleNav} />;
    }
  };

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:"#F8FAFC", fontFamily:"system-ui,-apple-system,sans-serif" }}>
      <Sidebar page={creating?"surveys":page} setPage={handleNav} />
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <TopBar title={creating?"Nova Pesquisa":PAGE_LABELS[page]} unreadCount={unreadCount} onBell={() => handleNav("notificacoes")} />
        <main style={{ flex:1, overflowY:"auto" }}>{renderContent()}</main>
      </div>
      {!lgpdOk && <LGPDBanner onAccept={() => setLgpdOk(true)} />}
    </div>
  );
}
