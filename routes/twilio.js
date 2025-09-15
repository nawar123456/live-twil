// routes/twilio.js
const express = require('express');
const router = express.Router();
const { createVideoRoom, generateAccessToken } = require('../controllers/twilioController');

// إنشاء غرفة فيديو
router.post('/create-room', createVideoRoom);

// إنشاء Access Token
router.post('/token', generateAccessToken);

module.exports = router;