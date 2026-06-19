'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/respondents.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog }                = require('../middleware/audit');

router.use(authenticate);
router.get('/',                  ctrl.list);
router.post('/',                 authorize('admin','manager'), auditLog('respondent.create','respondent'), ctrl.create);
router.post('/import',           authorize('admin','manager'), auditLog('respondent.import','respondent'), ctrl.importCSV);
router.post('/:id/consent',      auditLog('lgpd.consent','respondent'), ctrl.registerConsent);
router.delete('/:id',            authorize('admin'), auditLog('lgpd.anonymize','respondent'), ctrl.anonymize);
module.exports = router;
