'use strict';
const router = require('express').Router();
const c = require('../controllers/org.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', c.list);

router.post('/regionais',        authorize('admin', 'manager'), c.createRegional);
router.put('/regionais/:id',     authorize('admin', 'manager'), c.updateRegional);
router.delete('/regionais/:id',  authorize('admin'),            c.deleteRegional);

router.post('/distritos',        authorize('admin', 'manager'), c.createDistrito);
router.put('/distritos/:id',     authorize('admin', 'manager'), c.updateDistrito);
router.delete('/distritos/:id',  authorize('admin'),            c.deleteDistrito);

router.post('/departamentos',       authorize('admin', 'manager'), c.createDepartamento);
router.put('/departamentos/:id',    authorize('admin', 'manager'), c.updateDepartamento);
router.delete('/departamentos/:id', authorize('admin'),            c.deleteDepartamento);

router.post('/import', authorize('admin', 'manager'), c.importStructure);
module.exports = router;
