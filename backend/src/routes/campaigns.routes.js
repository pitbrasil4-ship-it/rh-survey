'use strict';
const router = require('express').Router();
const c      = require('../controllers/campaigns.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog }                = require('../middleware/audit');

router.use(authenticate);
router.get('/',        c.list);
router.post('/',       authorize('admin','manager'), auditLog('campaign.create','campaign'), c.create);
router.put('/:id',     authorize('admin','manager'), auditLog('campaign.update','campaign'), c.update);
router.delete('/:id',  authorize('admin'),           auditLog('campaign.delete','campaign'), c.remove);
module.exports = router;
