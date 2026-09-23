'use strict';
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const cors        = require('cors');

const corsOptions = {
  origin:      process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Tenant-Slug','X-Survey-Password'],
};

/* Os tetos são POR IP — e é isso que decide o número. Uma empresa responde a pesquisa
 * atrás de um punhado de IPs de saída: o distrito inteiro sai pelo mesmo endereço. Um
 * teto pensado para "uma pessoa" derruba a coleta no primeiro dia de campanha.
 *
 * Contra resposta em massa o que protege é o controle de duplicidade, a cota por
 * distrito e o convite nominal — não o limitador, que existe para conter abuso
 * automatizado. */
const GLOBAL_MAX = Number(process.env.RATE_LIMIT_MAX) > 0 ? Number(process.env.RATE_LIMIT_MAX) : 300;
const PUBLIC_MAX = Number(process.env.PUBLIC_RATE_LIMIT_MAX) > 0 ? Number(process.env.PUBLIC_RATE_LIMIT_MAX) : 300;

const ROTA_PUBLICA = /^\/api\/v1\/public\//;

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: GLOBAL_MAX,
  // O formulário público tem limitador próprio, dimensionado para a coleta. Sem esta
  // exceção, o teto do painel (300 por IP) barrava a empresa inteira respondendo.
  skip: (req) => ROTA_PUBLICA.test(req.originalUrl || req.url || ''),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Muitas requisições. Tente novamente em 15 minutos.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: PUBLIC_MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Muitos acessos ao formulário neste momento. Aguarde um minuto e tente de novo.' },
});

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'","'unsafe-inline'"],
      imgSrc:     ["'self'","data:","https:"],
      connectSrc: ["'self'"],
      frameSrc:   ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
});

module.exports = { corsOptions, globalLimiter, authLimiter, publicLimiter, helmetConfig, cors };
