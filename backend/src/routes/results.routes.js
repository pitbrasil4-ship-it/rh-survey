'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/results.controller');
const { authenticate } = require('../middleware/auth');
const { auditLog }     = require('../middleware/audit');

router.use(authenticate);
router.get('/dashboard',     ctrl.getDashboard);
router.get('/segments',      ctrl.getSegments);
router.get('/segment-questions', ctrl.getSegmentQuestions);
router.get('/:surveyId/pdf',  auditLog('results.pdf','survey'), ctrl.getPdf);
router.post('/insights-pdf',  auditLog('results.insightsPdf','survey'), ctrl.getInsightsPdf);
router.post('/insights',     auditLog('results.insights','survey'), ctrl.getInsights);
router.get('/:surveyId',     auditLog('results.view','survey'), ctrl.getSurveyResults);
module.exports = router;
