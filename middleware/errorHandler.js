// Error handler middleware
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = Array.isArray(err.message) ? err.message.join(', ') : err.message;

    if (process.env.NODE_ENV !== 'test') {
        console.error({
            message: err.message,
            name: err.name,
            statusCode: err.statusCode || 500,
            path: req.originalUrl,
            method: req.method,
        });
    }

    if (res.headersSent) {
        return next(err);
    }

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        const message = 'Resource not found';
        error = { message, statusCode: 404 };
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        const message = `${field} already exists`;
        error = { message, statusCode: 400 };
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors).map(val => val.message).join(', ');
        error = { message, statusCode: 400 };
    }

    if (err.name === 'MulterError') {
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'Uploaded file exceeds the allowed size.'
            : 'Invalid file upload.';
        error = { message, statusCode: 400 };
    }

    if (err.statusCode && !error.statusCode) {
        error.statusCode = err.statusCode;
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        const message = 'Invalid token';
        error = { message, statusCode: 401 };
    }

    if (err.name === 'TokenExpiredError') {
        const message = 'Token expired';
        error = { message, statusCode: 401 };
    }

    res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = errorHandler;
