'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/users.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog }                = require('../middleware/audit');

// User management is admin-only across the board.
router.use(authenticate);
router.use(authorize('admin'));

router.get('/',        ctrl.list);
router.post('/',       auditLog('user.create','user'), ctrl.create);
router.put('/:id',     auditLog('user.update','user'), ctrl.update);
router.delete('/:id',  auditLog('user.deactivate','user'), ctrl.remove);
module.exports = router;
