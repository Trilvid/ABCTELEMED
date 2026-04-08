
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminController');
const withdrawalCtrl = require('../controllers/withdrawalController');
const { protect, requireSuperAdmin } = require('../middleware/authMiddleware');

const auth = protect('admin');  // shorthand

// ── Auth ─────
router.post('/login', ctrl.login);
router.get('/me', auth, ctrl.getMe);

// ── Admin management (superAdmin only) ────────
router.post('/create', auth, requireSuperAdmin, ctrl.createAdmin);
router.get('/admins', auth, requireSuperAdmin, ctrl.getAdmins);
router.patch('/admins/:id/status', auth, requireSuperAdmin, ctrl.toggleAdminStatus);
router.delete('/admins/:id', auth, requireSuperAdmin, ctrl.deleteAdmin);

// ── Platform stats ──────
router.get('/stats', auth, ctrl.getStats);

// ── Doctors ──────
router.get('/doctors', auth, ctrl.getDoctors);
router.get('/doctors/:id', auth, ctrl.getDoctorDetail);
router.patch('/doctors/:id/verify', auth, ctrl.verifyDoctor);
router.patch('/doctors/:id/status', auth, ctrl.updateDoctorStatus);

// ── Patients ─────
router.get('/patients', auth, ctrl.getPatients);
router.get('/patients/:id', auth, ctrl.getPatientDetail);
router.patch('/patients/:id', auth, ctrl.updatePatient);

// ── Consultations ───────
router.get('/consultations', auth, ctrl.getConsultations);
router.get('/consultations/:id', auth, ctrl.getConsultationDetail);

// ── Earnings & Payouts ─────────
router.get('/earnings', auth, ctrl.getEarnings);
router.get('/earnings/doctor/:doctorId', auth, ctrl.getDoctorEarnings);
router.patch('/earnings/:id/payout', auth, ctrl.processPayout);
router.post('/earnings/bulk-payout', auth, ctrl.bulkPayout);

// ── Withdrawals (admin processing) ─────────
router.get('/withdrawals', auth, withdrawalCtrl.adminGetWithdrawals);
router.patch('/withdrawals/:id', auth, withdrawalCtrl.adminProcessWithdrawal);

// ── Audit logs ───
router.get('/audit-logs', auth, ctrl.getAuditLogs);

module.exports = router;