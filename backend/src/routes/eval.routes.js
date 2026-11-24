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
router.get('/results/:cycleId/subject/:subjectId',     ctrl.subjectResults);
router.get('/results/:cycleId/subject/:subjectId/pdf', auditLog('eval.subject_pdf','eval'), ctrl.subjectPdf);
router.post('/cycles/:id/assignments/bulk', authorize('admin','manager'), auditLog('eval.assign_bulk','eval'), ctrl.bulkAssign);
router.get('/cycles/:id/pending',           ctrl.pendingList);
module.exports = router;
