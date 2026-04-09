const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const bodyLimit = process.env.REQUEST_BODY_LIMIT || '1mb';
const jsonParser = express.json({ limit: bodyLimit });
const urlEncodedParser = express.urlencoded({ extended: true, limit: bodyLimit });
const webhookRawParser = express.raw({ type: 'application/json', limit: bodyLimit });

const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_URL || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const createAuthLimiter = () => rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many authentication attempts. Please try again later.' },
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT_MAX || 300),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.originalUrl.includes('/webhook'),
    message: { status: 'error', message: 'Too many requests. Please slow down and try again shortly.' },
});

const sanitizeValue = (value) => {
    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }

    if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Date) {
        return value;
    }

    Object.keys(value).forEach((key) => {
        const sanitizedKey = key.replace(/\$/g, '').replace(/\./g, '');
        const sanitizedValue = sanitizeValue(value[key]);

        if (sanitizedKey !== key) {
            delete value[key];
        }

        value[sanitizedKey] = sanitizedValue;
    });

    return value;
};

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        const err = new Error('Origin not allowed by CORS policy');
        err.statusCode = 403;
        return callback(err);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Paystack-Signature', 'Verif-Hash'],
}));

// Body parser middleware
app.use('/api/paystack/webhook', webhookRawParser);
app.use((req, res, next) => {
    if (req.originalUrl === '/api/paystack/webhook') {
        return next();
    }

    return jsonParser(req, res, next);
});
app.use(urlEncodedParser);

// Sanitize data
app.use((req, res, next) => {
    if (req.originalUrl === '/api/paystack/webhook') {
        return next();
    }

    sanitizeValue(req.body);
    sanitizeValue(req.params);
    sanitizeValue(req.query);
    return next();
});

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'production') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

app.use('/api', apiLimiter);
app.use('/api/doctors/login', createAuthLimiter());
app.use('/api/doctors/forgot-password', createAuthLimiter());
app.use('/api/doctors/reset-password', createAuthLimiter());
app.use('/api/admin/login', createAuthLimiter());

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
app.use('/api/admin', require('./routes/admin'));
app.use('/api/upload', require('./routes/upload'));


// Welcome route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to ABC Telemedica System API',
        version: '1.0.0',
        endpoints: {
            doctors: '/api/doctors',
            users: '/api/users',
        }
    });
});

// 404 handler
app.use((req, res, next) => {
    const err = new Error('Route not found');
    err.statusCode = 404;
    next(err);
});

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
