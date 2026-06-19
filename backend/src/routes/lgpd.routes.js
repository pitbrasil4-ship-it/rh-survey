'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/lgpd.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog }                = require('../middleware/audit');

router.use(authenticate);
router.get('/consents',   auditLog('lgpd.consents.list'), ctrl.getConsents);
router.get('/audit-log',  authorize('admin'), auditLog('lgpd.audit.view'), ctrl.getAuditLog);
router.get('/report',     authorize('admin'), auditLog('lgpd.report.generate'), ctrl.getReport);
module.exports = router;
