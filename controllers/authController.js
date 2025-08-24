const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const transporter = require('../config/mailer');

exports.registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normEmail = email.trim().toLowerCase();
    const normName = (name || normEmail).trim();

    // generate a verification token
    const verificationToken = crypto.randomBytes(20).toString('hex');

    // create user and include verification token / isVerified flag
    const user = await User.create({
      name: normName,
      email: normEmail,
      password,
      verificationToken,     // store token
      isVerified: false      // ensure the flag exists (depends on User model)
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // send verification email using the verificationToken (non-blocking)
    (async () => {
      try {
        //const verifyUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/verify/${verificationToken}`;
        //const verifyUrl = `${process.env.CLIENT_URL || 'https://note-sharing-frontend.vercel.app/'}/verify/${verificationToken}`;
        const verifyUrl = `${process.env.CLIENT_URL || 'https://notesharing-frontend.onrender.com'}/verify/${verificationToken}`;
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: 'Welcome to Campus Notes — verify your email',
          html: `<p>Hi ${user.name}, welcome.</p>
                 <p>Click to verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p>`
        });
        console.log('Registration email queued for', user.email);
      } catch (mailErr) {
        console.warn('Failed to send registration email for', user.email, mailErr && mailErr.message);
      }
    })();

    return res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('[auth] registerUser error', err);
    return res.status(500).json({ message: 'Registration failed' });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ message: 'Invalid verification token' });

    const user = await User.findOne({ verificationToken: token });

    if (user) {
      // If already verified, be idempotent and return success
      if (user.isVerified) {
        user.verificationToken = null; // cleanup if left over
        await user.save();
        return res.json({ message: 'Email already verified' });
      }

      // Otherwise mark verified
      user.isVerified = true;
      user.verificationToken = null;
      await user.save();
      return res.json({ message: 'Email verified' });
    }

    // Token not found -> return success/friendly message so repeated requests don't show "Invalid"
    return res.json({ message: 'Email already verified or token expired' });
  } catch (err) {
    console.error('[auth] verifyEmail error', err);
    return res.status(500).json({ message: 'Verification failed' });
  }
};

exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    if (!user.isVerified)
      return res.status(403).json({ message: 'Please verify your email first' });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '7d'
    });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('name email isVerified');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
