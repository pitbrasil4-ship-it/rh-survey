'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/audit.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('admin'), ctrl.listAudit);
module.exports = router;
