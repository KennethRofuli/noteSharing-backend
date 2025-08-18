const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/register', authController.registerUser);
router.post('/login', authController.loginUser);

// add verify endpoint (public)
router.get('/verify/:token', authController.verifyEmail);

router.get('/me', require('../middleware/auth'), authController.me);

module.exports = router;
