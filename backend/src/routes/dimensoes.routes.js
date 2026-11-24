'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/dimensoes.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authenticate);
router.get('/',                      ctrl.list);
router.get('/survey/:surveyId',      ctrl.bySurvey);
router.post('/',                     authorize('admin','manager'), auditLog('dimensao.create','dimensao'), ctrl.create);
router.post('/hse-padrao',           authorize('admin','manager'), auditLog('dimensao.seed_hse','dimensao'), ctrl.seedHse);
router.put('/question/:questionId',  authorize('admin','manager'), auditLog('dimensao.link','dimensao'), ctrl.setForQuestion);
router.put('/:id',                   authorize('admin','manager'), auditLog('dimensao.update','dimensao'), ctrl.update);
router.delete('/:id',                authorize('admin','manager'), auditLog('dimensao.delete','dimensao'), ctrl.remove);

module.exports = router;
