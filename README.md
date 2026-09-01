# RH Survey — Plataforma de Avaliação Organizacional

> Stack: Node.js 22 · Express · SQLite/PostgreSQL · React · LGPD Compliant

## Estrutura do repositório

```
rh-survey/
├── backend/              # API Node.js (Railway)
│   ├── src/
│   │   ├── app.js
│   │   ├── server.js
│   │   ├── config/       database.js
│   │   ├── middleware/   auth · security · audit · lgpd
│   │   ├── routes/       auth · surveys · respondents · responses · results · lgpd
│   │   ├── controllers/  auth · surveys · respondents · responses · results · lgpd
│   │   └── utils/        jwt · crypto · nps · logger · response · seed
│   ├── railway.toml
│   ├── Dockerfile
│   └── package.json
├── frontend/             # React SPA (Vercel)
│   ├── RHSurvey.jsx
│   └── vercel.json
├── .github/
│   └── workflows/
│       └── deploy.yml    # CI/CD automático
└── .gitignore
```

---

## 🚀 Setup em 5 passos

### 1. Criar repositório no GitHub
```bash
git init
git add .
git commit -m "feat: RH Survey — versão inicial"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/rh-survey.git
git push -u origin main
```

### 2. Configurar Railway (backend)
1. Acesse [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo** → selecione `rh-survey`
3. Selecione a pasta `backend`
4. Adicione as variáveis de ambiente (veja abaixo)
5. Railway detecta o `railway.toml` e faz deploy automático

### 3. Configurar Vercel (frontend)
1. Acesse [vercel.com](https://vercel.com) → **New Project**
2. Importe o repositório `rh-survey`
3. **Root Directory:** `frontend`
4. Adicione a variável `VITE_API_URL` apontando para a URL do Railway
5. Deploy automático a cada push na `main`

### 4. Adicionar secrets no GitHub
Em **Settings → Secrets → Actions**, adicione:

| Secret | Como obter |
|--------|-----------|
| `RAILWAY_TOKEN` | Railway → Account Settings → Tokens |
| `VERCEL_TOKEN` | Vercel → Account → Tokens |
| `VERCEL_ORG_ID` | `vercel env ls` ou Dashboard |
| `VERCEL_PROJECT_ID` | `vercel env ls` ou Dashboard |

### 5. Primeiro deploy
```bash
git push origin main
# GitHub Actions executa automaticamente:
# ✅ Testa o backend
# ✅ Faz deploy no Railway
# ✅ Faz deploy na Vercel
```

---

## 🔐 Variáveis de Ambiente — Railway

```env
# Banco de dados (Railway provisiona automaticamente)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Autenticação (gere strings aleatórias de 64 chars)
JWT_SECRET=<gere_com_openssl_rand_hex_32>
JWT_REFRESH_SECRET=<gere_com_openssl_rand_hex_32>
ENCRYPTION_KEY=<exatamente_32_caracteres>

# IA
ANTHROPIC_API_KEY=sk-ant-...

# Configurações
CORS_ORIGIN=https://rh-survey.vercel.app
NODE_ENV=production
BCRYPT_ROUNDS=12
PORT=4000
DPO_EMAIL=dpo@suaempresa.com.br
```

---

## 🔐 Variáveis de Ambiente — Vercel

```env
VITE_API_URL=https://rh-survey-api.railway.app
```

---

## ✉️ Envio de convites pelo servidor

A Central de Distribuição dispara os convites pelo próprio servidor — é o que dá
rastreamento (enviado / aberto / respondido), lembrete automático para quem não
respondeu e o painel de adesão por distrito durante a coleta.

Para ligar o envio automático, defina no Railway:

```env
RESEND_API_KEY=re_...                      # conta em resend.com
MAIL_FROM=RH Survey <rh@suaempresa.com.br> # domínio verificado no Resend
APP_URL=https://rh-survey.vercel.app       # base dos links de convite
```

Sem a chave, os convites são criados mas não saem: a tela mostra o motivo e o RH
continua podendo usar o envio manual (mailto / copiar mensagem / WhatsApp).

Os lembretes agendados são processados pelo próprio servidor, a cada minuto,
enviando apenas para quem ainda não respondeu.

---

## 🧩 Modelo de perguntas

Cada pergunta guarda, além do texto em PT/EN/ES:

| Campo | Para que serve |
|-------|----------------|
| `options` + `options_en/es` | rótulos das alternativas, editáveis por idioma |
| `option_points` | peso (%) de cada alternativa, alinhado por índice |
| `required` | obrigatoriedade por questão |
| `config.neutralIndex` | opção neutra (ex.: "Não se aplica") — fora do denominador |
| `config.allowOther` / `otherLabel` | opção "Outros" com campo aberto |
| `config.rows` | linhas da Matriz (as colunas são as `options`) |
| `config.fields` | campos do Bloco de Formulário, com validação de e-mail/telefone/data |
| `logic.showIf` | exibe a pergunta só se a de nº `order` tiver uma das alternativas |
| `logic.endIf` | encerra o questionário quando uma destas alternativas é marcada |
| `dimensions` | vínculo N:N com as dimensões cadastradas (várias taxonomias) |

Tipos disponíveis: `nps`, `scale` (Likert configurável), `multiple`, `dropdown`,
`matrix`, `form`, `text`, `rating`, `yesno`.

---

## 🔄 Fluxo de deploy automático

```
git push origin main
       │
       ▼
  GitHub Actions
       │
  ┌────┴────┐
  │         │
  ▼         ▼
Railway   Vercel
(backend) (frontend)
  │         │
  ▼         ▼
 ✅ API   ✅ SPA
rodando  no ar
```

---

## 📋 Endpoints da API

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET    | /health | ❌ | Status e segurança |
| POST   | /api/v1/auth/register | ❌ | Criar conta |
| POST   | /api/v1/auth/login | ❌ | Login → JWT |
| GET    | /api/v1/auth/me | ✅ | Perfil |
| GET    | /api/v1/surveys | ✅ | Listar pesquisas |
| POST   | /api/v1/surveys | ✅ | Criar pesquisa |
| POST   | /api/v1/surveys/:id/publish | ✅ | Publicar |
| POST   | /api/v1/surveys/generate-ai | ✅ | IA gera perguntas |
| GET    | /api/v1/public/survey/:token | ❌ | Formulário público |
| POST   | /api/v1/public/survey/:token | ❌ | Submeter resposta |
| GET    | /api/v1/results/dashboard | ✅ | Dashboard |
| GET    | /api/v1/results/:surveyId | ✅ | Resultados + NPS |
| GET    | /api/v1/lgpd/consents | ✅ | Consentimentos |
| GET    | /api/v1/lgpd/report | ✅ Admin | Relatório LGPD |
| GET    | /api/v1/lgpd/audit-log | ✅ Admin | Trilha de auditoria |
| PUT    | /api/v1/surveys/:id | ✅ | Editar pesquisa (perguntas incluídas, se não houver respostas) |
| POST   | /api/v1/surveys/:id/duplicate | ✅ | Duplicar como novo rascunho |
| GET    | /api/v1/dimensions | ✅ | Conjuntos de dimensões e suas dimensões |
| POST   | /api/v1/dimensions/sets · /api/v1/dimensions | ✅ | Cadastrar conjunto / dimensão |
| GET    | /api/v1/campaigns | ✅ | Campanhas (instrumento × período) e adesão |
| POST   | /api/v1/campaigns | ✅ | Criar campanha com meta por distrito |
| GET    | /api/v1/invitations/survey/:id | ✅ | Convites, com rastreio e lembretes agendados |
| POST   | /api/v1/invitations/survey/:id | ✅ | Criar e disparar convites pelo servidor |
| POST   | /api/v1/invitations/survey/:id/remind | ✅ | Lembrar quem não respondeu |
| GET    | /api/v1/invitations/survey/:id/adherence | ✅ | Adesão por distrito durante a coleta |

---

## 🛡️ Segurança

- JWT access token (1h) + refresh token revogável (7d)
- Escopo por regional/distrito no usuário: um Gestor amarrado a um distrito só
  enxerga resultados e respondentes daquele distrito
- Supressão de resultados por categoria de pesquisa (o Gestor não vê a avaliação
  em que ele é o avaliado)
- Controle de duplicidade por dispositivo, link de convite de uso único e limite
  de respostas por pesquisa
- bcryptjs rounds 12 (~250ms por hash)
- Helmet: CSP + HSTS + X-Frame-Options
- Rate limiting: 300 req/15min global · 10 req/15min em /login
- IPs armazenados apenas como HMAC SHA-256
- Anonimização LGPD Art. 18 via endpoint dedicado
- Trilha de auditoria imutável em banco

---

*RH Survey — Plataforma de Avaliação Organizacional · LGPD Compliant*
