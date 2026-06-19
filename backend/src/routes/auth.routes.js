'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { authLimiter }  = require('../middleware/security');
const { auditLog }     = require('../middleware/audit');

router.post('/register', authLimiter, ctrl.register);
router.post('/login',    authLimiter, auditLog('user.login','auth'), ctrl.login);
router.post('/refresh',  ctrl.refresh);
router.post('/logout',   ctrl.logout);
router.get('/me',        authenticate, ctrl.me);
module.exports = router;
