const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // your auth middleware
const authController = require('../controllers/authController');

router.post('/register', authController.registerUser);
router.post('/login', authController.loginUser);
router.get('/me', auth, authController.me);

module.exports = router;
