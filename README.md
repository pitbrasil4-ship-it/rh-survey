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

## 📄 Planilha de importação

A importação lê a planilha do RH como ela é. Colunas aceitas:

| Coluna | Conteúdo |
|--------|----------|
| `Nº` / `ID` | identificador; na falta dele, o prefixo `Q12.` do próprio texto |
| `Pergunta` (+ `(EN)` / `(ES)`) | enunciado, com as traduções opcionais |
| `Tipo` | escala, múltipla, lista suspensa, matriz, formulário, texto, NPS, estrelas, sim/não |
| `Opções` (+ `(EN)` / `(ES)`) | alternativas separadas por `;` |
| `Pesos` | posição na escala (`1;2;3;4`) **ou** percentual (`0;33;67;100`); `(sem peso)` marca a opção neutra |
| `Dimensão_Clima`, `Dimensão_HSE` | uma coluna por taxonomia; dentro da coluna, `\|` separa duas dimensões |
| `Obrigatória` | Sim / Não |
| `Observação` | nota interna; “segmentação” aqui marca a pergunta como recorte |

Título e subtítulo antes do cabeçalho são ignorados, assim como as linhas de
rodapé. Nomes de dimensão são resolvidos com tolerância a acento, caixa e nome
curto (“Segurança” → “Segurança no Trabalho”); o que não casar é listado na tela
em vez de sumir calado.

`GET /api/v1/surveys/:id/export` devolve as perguntas **nesse mesmo formato**,
para revisão fora do sistema e reimportação sem conversão manual.

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
| `config.favorableFrom` | a partir de qual posição a resposta conta como Favorável |
| `config.segmentation` | pergunta de recorte: não pontua e abre os demais resultados |
| `logic.showIf` | exibe a pergunta só se a de nº `order` tiver uma das alternativas |
| `logic.endIf` | encerra o questionário quando uma destas alternativas é marcada |
| `dimensions` | vínculo N:N com as dimensões cadastradas (várias taxonomias) |
| `notes` | observação interna, não exibida a quem responde |

Tipos disponíveis: `nps`, `scale` (Likert configurável), `multiple`, `dropdown`,
`matrix`, `form`, `text`, `rating`, `yesno`.

---

## 📐 Duas taxonomias sobre a mesma coleta

A classificação das perguntas não é configuração inicial: muda a cada ciclo. Por
isso é **campo da pergunta**, com um campo por taxonomia e seleção múltipla em cada:

| Conjunto | Código | Regra na RGIS |
|----------|--------|---------------|
| Clima Organizacional — RGIS | `clima` | 12 dimensões; cada pergunta pertence a exatamente uma |
| HSE Management Standards | `hse` | 7 dimensões; a mesma pergunta pode pertencer a duas |

A mesma resposta alimenta o relatório de Clima e o de HSE — a pesquisa não é
aplicada duas vezes. Pergunta sem dimensão é válida (segmentação e campo aberto
não entram em nenhuma). Duas dimensões do mesmo conjunto geram **aviso, não
bloqueio**: o sistema explica que a resposta contará duas vezes na média e deixa
salvar.

**Reclassificar tem vigência.** Ao mudar a dimensão de uma pesquisa que já tem
respostas, o sistema pergunta se vale para as respostas já coletadas (retroativo)
ou só daqui em diante (prospectivo). No modo prospectivo, cada resposta continua
sendo lida com a classificação que valia no dia em que foi enviada — escolher por
omissão corromperia a série histórica em silêncio.

---

## 📊 Favorabilidade e semáforo

| Regra | Definição |
|-------|-----------|
| Favorável | posições a partir de `favorableFrom` (numa escala de 4 pontos, a metade de cima) |
| Desfavorável | posições abaixo disso |
| Base | exclui a opção neutra (`neutralIndex`) |
| Níveis | por pergunta, por dimensão (média das perguntas) e geral (média das dimensões) |

O **semáforo corta sobre a desfavorabilidade**, não sobre a favorabilidade:

- 🟢 verde — desfavorabilidade abaixo de 20%
- 🟡 atenção — de 20% a 30%
- 🔴 crítico — 30% ou mais

Vale igualmente para pergunta, dimensão, distrito, regional e recorte por
modalidade.

---

## 🕓 Versões e histórico

Cada publicação congela uma **versão numerada e datada**, com o questionário
inteiro, e a resposta fica ligada à versão que estava no ar quando foi enviada.
Em paralelo, o **histórico** registra quem alterou o quê e quando em texto,
alternativa, peso e classificação.

Pesquisa publicada continua editável: texto, rótulos, pesos e dimensão mudam sem
perder resposta. Só é recusado o que invalidaria dado já gravado — trocar o tipo,
encurtar a escala abaixo do que já foi respondido, ou remover pergunta respondida
— e a recusa é por pergunta, com o motivo na tela.

---

## 🔗 Coletor: senha, cotas, variáveis no link e randomização

O coletor é a forma como a pesquisa chega ao respondente. As opções ficam no
editor da pesquisa, no painel **Opções do coletor**:

| Opção | O que faz |
|---|---|
| **Senha de acesso** | O formulário só abre com a senha. Ela é guardada em hash e nunca volta para a tela: o editor mostra apenas “senha definida”, com a opção de remover. A senha é revalidada no envio, para que não baste chamar a API direto. |
| **Página de agradecimento** | Substitui o texto final padrão. |
| **Permitir corrigir a resposta** | Quem já respondeu reabre o formulário com o que enviou e ajusta. A correção regrava a mesma resposta — não entra como resposta nova na apuração. Pelo link nominal a pessoa é reconhecida pelo convite; pelo link geral, pelo próprio navegador (a pesquisa continua anônima: o identificador é aleatório e fica no dispositivo). |
| **Cota por distrito** | O distrito para de receber respostas ao atingir a meta cadastrada na Estrutura. Quem abre o link depois disso vê a tela de cota atingida, com o número já recebido. |
| **Embaralhar alternativas** | Só nas perguntas de escolha sem peso e sem alternativa neutra — escala pontuada e “Não se aplica” nunca são embaralhadas. |
| **Embaralhar perguntas** | Desligado automaticamente quando o questionário tem lógica condicional, que depende da ordem. A ordem é sorteada por respondente e **se mantém se a pessoa recarregar a página**. |

### Variáveis no link

O link pode já trazer a classificação do respondente:

```
https://<app>/r/<token>?distrito=SP+Capital&modalidade=Mensalista
```

Aceita `distrito`, `regional`, `departamento` e `modalidade`, por id ou por nome
(sem diferenciar acento ou caixa). Com isso a resposta nasce classificada e a
pergunta de segmentação **some do formulário**, já respondida pelo link. O que não
casar com o cadastro é descartado e registrado — nada entra classificado por
engano. O que foi reconhecido aparece como selo no topo do formulário, para o
respondente conferir.

---

## 🔀 Cruzamento

Em Resultados, o painel **Cruzamento** monta a matriz entre dois eixos quaisquer —
pergunta × pergunta ou pergunta × segmento (modalidade, distrito, regional,
departamento). Os percentuais são sobre o total da linha, a coluna neutra vem
destacada, cada linha traz favorabilidade e semáforo, e a matriz exporta em CSV.
Respostas sem classificação no eixo escolhido ficam de fora e são informadas no
rodapé, em vez de sumirem da conta.

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
| GET    | /api/v1/results/:surveyId/crosstab-axes | ✅ | Eixos disponíveis para o cruzamento |
| GET    | /api/v1/results/:surveyId/crosstab | ✅ | Matriz de cruzamento (`rows`/`cols`: `q:<id>` ou `seg:<recorte>`) |
| GET    | /api/v1/surveys/:id/versions · /history | ✅ | Versões publicadas e histórico de alterações |
| GET    | /api/v1/surveys/:id/export-questions | ✅ | Questionário no formato da planilha |

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
