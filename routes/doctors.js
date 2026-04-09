
const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctorController');
const withdrawalCtrl = require('../controllers/withdrawalController');
const { protect } = require('../middleware/authMiddleware');

// ── Public ────
router.post('/register', doctorController.register);
router.post('/login', doctorController.login);
router.post('/forgot-password', doctorController.forgotPassword);
router.patch('/reset-password/:token', doctorController.resetPassword);
router.get('/', doctorController.getAllDoctors);

// ── Doctor-protected ───
router.patch('/:id', protect('doctor'), doctorController.updateProfile);
router.patch('/:id/availability', protect('doctor'), doctorController.updateAvailability);

// Doctor withdrawal routes (protected)
router.post('/withdraw', protect('doctor'), withdrawalCtrl.requestWithdrawal);
router.get('/withdrawals', protect('doctor'), withdrawalCtrl.getMyWithdrawals);
router.get('/earnings/summary', protect('doctor'), withdrawalCtrl.getEarningsSummary);

// ── Admin-protected ──
router.patch('/:id/verify', protect('admin'), doctorController.verifyDoctor);
router.get('/:id', doctorController.getDoctorById);

module.exports = router;
