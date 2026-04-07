const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const compression = require('compression');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const jsonParser = express.json({ limit: '100mb' });
const urlEncodedParser = express.urlencoded({ extended: true, limit: '100mb' });

// Security middleware
app.use(helmet());

app.use(cors());

// Body parser middleware
app.use('/api/paystack/webhook', express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
    if (req.originalUrl === '/api/paystack/webhook') {
        return next();
    }

    return jsonParser(req, res, next);
});
app.use(urlEncodedParser);

// Sanitize data
// app.use(mongoSanitize());
app.use((req, res, next) => {
    mongoSanitize.sanitize(req.body);
    mongoSanitize.sanitize(req.params);
    next();
});

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'production') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

// Static files
app.use('/uploads', express.static('uploads'));

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// // API routes
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/consultations', require('./routes/consultations'));
app.use('/api/paystack', require('./routes/paystack'));
app.use('/api/flutterwave', require('./routes/flutterwave'));


// Welcome route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to ABC Telemed System API',
        version: '1.0.0',
        endpoints: {
            doctors: '/api/doctors',
            users: '/api/users',
        }
    });
});

// 404 handler
app.use('/:path', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;