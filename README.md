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

---

## 🛡️ Segurança

- JWT access token (1h) + refresh token revogável (7d)
- bcryptjs rounds 12 (~250ms por hash)
- Helmet: CSP + HSTS + X-Frame-Options
- Rate limiting: 300 req/15min global · 10 req/15min em /login
- IPs armazenados apenas como HMAC SHA-256
- Anonimização LGPD Art. 18 via endpoint dedicado
- Trilha de auditoria imutável em banco

---

*RH Survey — Plataforma de Avaliação Organizacional · LGPD Compliant*
