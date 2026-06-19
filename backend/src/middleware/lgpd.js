'use strict';
const { getDB }   = require('../config/database');
const { forbidden } = require('../utils/response');

/**
 * Checks if a respondent has given LGPD consent before processing personal data.
 */
function requireConsent(req, res, next) {
  const respondentId = req.params?.respondentId || req.body?.respondentId;
  if (!respondentId) return next();
  const db    = getDB();
  const resp  = db.prepare('SELECT consent_given, anonymized FROM respondents WHERE id = ?').get(respondentId);
  if (!resp)               return next();
  if (resp.anonymized)     return forbidden(res, 'Dados anonimizados — acesso não permitido');
  if (!resp.consent_given) return forbidden(res, 'Consentimento LGPD não registrado para este respondente');
  next();
}

/**
 * Strips personal data from response objects when survey is anonymous.
 */
function anonymizeResponse(data) {
  if (!data) return data;
  const { name, email, cpf, phone, ...safe } = data;
  return safe;
}

module.exports = { requireConsent, anonymizeResponse };
