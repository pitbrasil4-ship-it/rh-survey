'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/eval.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authenticate);
router.get('/cycles',                    ctrl.listCycles);
router.post('/cycles',                   authorize('admin', 'manager'), auditLog('eval.cycle_create', 'eval'), ctrl.createCycle);
router.get('/cycles/:id',                ctrl.getCycle);
router.post('/cycles/:id/assignments',   authorize('admin', 'manager'), auditLog('eval.assign', 'eval'), ctrl.addAssignment);
router.delete('/assignments/:id',        authorize('admin', 'manager'), auditLog('eval.unassign', 'eval'), ctrl.removeAssignment);
router.get('/results/:cycleId',          ctrl.results);
module.exports = router;
