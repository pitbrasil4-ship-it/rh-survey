'use strict';
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const ACCESS_SECRET  = process.env.JWT_SECRET         || 'dev-secret-change-in-prod';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-change-in-prod';
const ACCESS_TTL     = process.env.JWT_EXPIRES_IN     || '1h';
const REFRESH_TTL    = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function signAccess(payload)  { return jwt.sign(payload, ACCESS_SECRET,  { expiresIn: ACCESS_TTL  }); }
function signRefresh(payload) { return jwt.sign({ ...payload, jti: randomUUID() }, REFRESH_SECRET, { expiresIn: REFRESH_TTL }); }
function verifyAccess(token)  { return jwt.verify(token, ACCESS_SECRET);  }
function verifyRefresh(token) { return jwt.verify(token, REFRESH_SECRET); }

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh };
