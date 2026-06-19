'use strict';
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const cors        = require('cors');

const corsOptions = {
  origin:      process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Tenant-Slug'],
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
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
  max: 30,
  message: { success: false, message: 'Limite de requisições atingido.' },
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
