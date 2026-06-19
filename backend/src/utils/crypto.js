'use strict';
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY  = Buffer.from((process.env.ENCRYPTION_KEY || 'rh-survey-aes-256-key-32chars!!').padEnd(32).slice(0,32));

function encrypt(text) {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(data) {
  const [ivHex, tagHex, encHex] = data.split(':');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex,'hex'));
  decipher.setAuthTag(Buffer.from(tagHex,'hex'));
  return decipher.update(Buffer.from(encHex,'hex'), undefined, 'utf8') + decipher.final('utf8');
}

function hashIP(ip) {
  return crypto.createHmac('sha256', KEY).update(ip || '').digest('hex');
}

module.exports = { encrypt, decrypt, hashIP };
