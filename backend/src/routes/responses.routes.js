'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/responses.controller');
const { publicLimiter } = require('../middleware/security');

// Public endpoints — no authentication required
router.get('/survey/:token',  publicLimiter, ctrl.getPublic);
router.post('/survey/:token', publicLimiter, ctrl.submitPublic);
module.exports = router;
