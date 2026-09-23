'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/comments.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authenticate);
router.get('/:surveyId', ctrl.list);
// Revisar é decisão de quem responde pelo relatório, não de quem só consulta.
router.put('/:surveyId/:answerId', authorize('admin', 'manager'), auditLog('comments.review', 'survey'), ctrl.review);
module.exports = router;
