'use strict';
const router = require('express').Router();
const c      = require('../controllers/invitations.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog }                = require('../middleware/audit');

router.use(authenticate);
router.get('/survey/:surveyId',            c.list);
router.get('/survey/:surveyId/adherence',  c.adherence);
router.post('/survey/:surveyId',           authorize('admin','manager'), auditLog('invitation.create','survey'), c.createBatch);
router.post('/survey/:surveyId/send',      authorize('admin','manager'), auditLog('invitation.send','survey'), c.sendPending);
router.post('/survey/:surveyId/remind',    authorize('admin','manager'), auditLog('invitation.remind','survey'), c.remind);
router.post('/survey/:surveyId/schedule',  authorize('admin','manager'), auditLog('invitation.schedule','survey'), c.schedule);
router.delete('/schedule/:id',             authorize('admin','manager'), auditLog('invitation.unschedule','reminder'), c.unschedule);
router.delete('/:id',                      authorize('admin','manager'), auditLog('invitation.delete','invitation'), c.remove);
module.exports = router;
