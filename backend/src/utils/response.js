'use strict';

function ok(res, data = {}, message = 'ok', status = 200) {
  return res.status(status).json({ success: true, message, data, timestamp: new Date().toISOString() });
}

function created(res, data = {}, message = 'Criado com sucesso') {
  return ok(res, data, message, 201);
}

function err(res, message = 'Erro interno', status = 500, details = null) {
  const body = { success: false, message, timestamp: new Date().toISOString() };
  if (details && process.env.NODE_ENV !== 'production') body.details = details;
  return res.status(status).json(body);
}

function notFound(res, resource = 'Recurso')  { return err(res, `${resource} não encontrado`, 404); }
function forbidden(res, msg = 'Acesso negado') { return err(res, msg, 403); }
function unauth(res, msg = 'Não autorizado')   { return err(res, msg, 401); }
function badReq(res, msg = 'Dados inválidos')  { return err(res, msg, 400); }

module.exports = { ok, created, err, notFound, forbidden, unauth, badReq };
