
const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctorController');
const { protect } = require('../middleware/authMiddleware');

// ── Public ────
router.post('/register', doctorController.register);
router.post('/login', doctorController.login);
router.post('/forgot-password', doctorController.forgotPassword);
router.patch('/reset-password/:token', doctorController.resetPassword);
router.get('/', doctorController.getAllDoctors);
router.get('/:id', doctorController.getDoctorById);

// ── Doctor-protected ───
router.patch('/:id', protect('doctor'), doctorController.updateProfile);
router.patch('/:id/availability', protect('doctor'), doctorController.updateAvailability);

// ── Admin-protected ──
router.patch('/:id/verify', protect('admin'), doctorController.verifyDoctor);

module.exports = router;