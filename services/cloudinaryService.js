
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Photo storage (profile pictures) ──────────────────────────────────────
const photoStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'abctelemed/doctors/photos',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
    },
});

// ── Certificate/document storage ───────────────────────────────────────────
const documentStorage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => ({
        folder: 'abctelemed/doctors/documents',
        allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
        resource_type: file.mimetype === 'application/pdf' ? 'raw' : 'image',
    }),
});

const uploadPhoto = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadDocument = multer({ storage: documentStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Generic delete helper
const deleteFile = async (publicId) => cloudinary.uploader.destroy(publicId);

module.exports = { cloudinary, uploadPhoto, uploadDocument, deleteFile };