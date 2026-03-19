const jwt = require('jsonwebtoken');
const Doctor = require('../models/Doctor');

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
            req.doctor = doctor;
        }

        // Extend with Admin model check when you build that

        next();
    } catch (err) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
    }
};

exports.restrictTo = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role))
        return res.status(403).json({ status: 'error', message: 'You do not have permission.' });
    next();
};