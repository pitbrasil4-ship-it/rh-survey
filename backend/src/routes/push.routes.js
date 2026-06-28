'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/push.controller');
const { authenticate } = require('../middleware/auth');

router.get('/vapid-public', ctrl.vapidPublic); // pública: só a chave pública VAPID
router.use(authenticate);
router.post('/subscribe',   ctrl.subscribe);
router.post('/unsubscribe', ctrl.unsubscribe);
router.post('/test',        ctrl.test);
module.exports = router;
