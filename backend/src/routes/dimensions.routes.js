'use strict';
const router = require('express').Router();
const c      = require('../controllers/dimensions.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog }                = require('../middleware/audit');

router.use(authenticate);
router.get('/', c.list);
router.post('/sets',       authorize('admin','manager'), auditLog('dimension.set_create','dimension_set'), c.createSet);
router.put('/sets/:id',    authorize('admin','manager'), auditLog('dimension.set_update','dimension_set'), c.updateSet);
router.delete('/sets/:id', authorize('admin'),           auditLog('dimension.set_delete','dimension_set'), c.deleteSet);
router.post('/',           authorize('admin','manager'), auditLog('dimension.create','dimension'), c.createDimension);
router.put('/:id',         authorize('admin','manager'), auditLog('dimension.update','dimension'), c.updateDimension);
router.delete('/:id',      authorize('admin'),           auditLog('dimension.delete','dimension'), c.deleteDimension);
module.exports = router;
