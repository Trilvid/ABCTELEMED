
const express = require('express');
const router = express.Router();
const { uploadPhoto, uploadDocument } = require('../services/cloudinaryService');
const { protect } = require('../middleware/authMiddleware');

// POST /api/upload/photo  (doctor auth required)
router.post('/photo', protect('doctor'), uploadPhoto.single('photo'), (req, res) => {
    if (!req.file)
        return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
    res.status(200).json({
        status: 'success',
        url: req.file.path,          // Cloudinary URL
        publicId: req.file.filename,      // Cloudinary public_id for later deletion
    });
});

// POST /api/upload/document  (doctor auth required)
router.post('/document', protect('doctor'), uploadDocument.single('document'), (req, res) => {
    if (!req.file)
        return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
    res.status(200).json({
        status: 'success',
        url: req.file.path,
        publicId: req.file.filename,
    });
});

// POST /api/upload/photo/public  (no auth — used during onboarding before login)
router.post('/photo/public', uploadPhoto.single('photo'), (req, res) => {
    if (!req.file)
        return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
    res.status(200).json({ status: 'success', url: req.file.path, publicId: req.file.filename });
});

router.post('/document/public', uploadDocument.single('document'), (req, res) => {
    if (!req.file)
        return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
    res.status(200).json({ status: 'success', url: req.file.path, publicId: req.file.filename });
});

module.exports = router;
