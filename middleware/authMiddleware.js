
const jwt = require('jsonwebtoken');
const Doctor = require('../models/Doctor');
const Admin = require('../models/Admin');

exports.protect = (role) => async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return res.status(401).json({ status: 'error', message: 'Not authenticated.' });

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (role === 'doctor') {
            const doctor = await Doctor.findById(decoded.id);
            if (!doctor) return res.status(401).json({ status: 'error', message: 'Doctor no longer exists.' });
            if (doctor.status === 'suspended')
                return res.status(403).json({ status: 'error', message: 'Your account has been suspended.' });
            req.doctor = doctor;
        }

        if (role === 'admin') {
            const admin = await Admin.findById(decoded.id);
            if (!admin) return res.status(401).json({ status: 'error', message: 'Admin account not found.' });
            if (!admin.isActive) return res.status(403).json({ status: 'error', message: 'This admin account is deactivated.' });
            // Verify token role matches DB role (prevents token reuse after role change)
            if (!['admin', 'superAdmin'].includes(decoded.role))
                return res.status(403).json({ status: 'error', message: 'Invalid token role.' });
            req.admin = admin;
        }

        next();
    } catch (err) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
    }
};

// Only superAdmin can access this route
exports.requireSuperAdmin = (req, res, next) => {
    if (!req.admin || req.admin.role !== 'superAdmin')
        return res.status(403).json({ status: 'error', message: 'SuperAdmin access required.' });
    next();
};

exports.restrictTo = (...roles) => (req, res, next) => {
    const user = req.admin || req.doctor;
    if (!user || !roles.includes(user.role))
        return res.status(403).json({ status: 'error', message: 'You do not have permission.' });
    next();
};