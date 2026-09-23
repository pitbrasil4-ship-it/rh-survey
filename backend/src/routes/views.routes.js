'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/views.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);
router.get('/',       ctrl.list);
router.post('/',      ctrl.create);
router.put('/:id',    ctrl.update);
router.delete('/:id', ctrl.remove);
module.exports = router;
