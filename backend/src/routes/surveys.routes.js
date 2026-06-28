'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/surveys.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog }                = require('../middleware/audit');

router.use(authenticate);
router.get('/',                                     ctrl.list);
router.post('/',        authorize('admin','manager'), auditLog('survey.create','survey'), ctrl.create);
router.get('/:id',                                  ctrl.getOne);
router.put('/:id',      authorize('admin','manager'), auditLog('survey.update','survey'), ctrl.update);
router.post('/:id/publish', authorize('admin','manager'), auditLog('survey.publish','survey'), ctrl.publish);
router.put('/:id/deadline', authorize('admin','manager'), auditLog('survey.deadline','survey'), ctrl.setDeadline);
router.delete('/:id',   authorize('admin'),           auditLog('survey.delete','survey'), ctrl.remove);
router.post('/generate-ai', authorize('admin','manager'), ctrl.generateAI);
router.post('/:id/translate', authorize('admin','manager'), auditLog('survey.translate','survey'), ctrl.translateExisting);
module.exports = router;
