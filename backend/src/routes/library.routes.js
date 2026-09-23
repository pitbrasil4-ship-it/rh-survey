'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/library.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);
router.get('/questions', ctrl.listQuestions);
router.get('/compare',   ctrl.compare);
module.exports = router;
