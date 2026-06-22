'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/responses.controller');
const evalCtrl = require('../controllers/eval.controller');
const { publicLimiter } = require('../middleware/security');

// Public endpoints — no authentication required
router.get('/survey/:token',  publicLimiter, ctrl.getPublic);
router.post('/survey/:token', publicLimiter, ctrl.submitPublic);
// Avaliação 360° — avaliador responde por link (sem auth)
router.get('/eval/:token',  publicLimiter, evalCtrl.getEvalPublic);
router.post('/eval/:token', publicLimiter, evalCtrl.submitEvalPublic);
module.exports = router;
