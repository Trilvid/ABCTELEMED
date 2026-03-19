// routes/whatsapp.js
const express = require('express');
const router = express.Router();
const { verifyWebhook, handleMessage } = require('../controllers/whatsappController');

router.get('/webhook', verifyWebhook);   // Meta verification
router.post('/webhook', handleMessage);  // Incoming messages

module.exports = router;