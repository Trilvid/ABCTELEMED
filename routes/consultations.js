const express = require('express');
const router = express.Router();
const consultationController = require('../controllers/consultationController');
const { protect } = require('../middleware/authMiddleware');

// Patient routes
router.post('/', consultationController.createConsultation);
router.get('/:id', consultationController.getConsultation);
router.get('/patient/:patientId', consultationController.getPatientConsultations);
router.patch('/:id/cancel', consultationController.cancelConsultation);

// Doctor routes
router.get('/doctor/:doctorId', protect('doctor'), consultationController.getDoctorConsultations);
router.patch('/:id', protect('doctor'), consultationController.updateConsultation);

module.exports = router;