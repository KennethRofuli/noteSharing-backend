const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const router = express.Router();

const Note = require('../models/Note');
const { uploadNote, getNotes, shareNote, deleteNote } = require('../controllers/noteController');
const authMiddleware = require('../middleware/auth');

// ✅ Allowed extensions for uploads
const allowedExtensions = [
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip"
];

// ✅ Max upload size (bytes) - override with env UPLOAD_MAX_BYTES, default 20 MB
const MAX_FILE_SIZE = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024;

// ✅ Multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// ✅ File filter to enforce allowed extensions
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error(`File type not allowed. Allowed extensions: ${allowedExtensions.join(', ')}`), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// ✅ Routes
// handle multer errors (e.g. file too large) and forward to controller on success
router.post('/upload', authMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: `File too large. Max size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB` });
      }
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}, uploadNote);
router.get('/', authMiddleware, getNotes);

// ✅ Download a note file
// ✅ Download a note file with access control
router.get('/download/:filename', authMiddleware, async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '../uploads', filename);

  try {
    // Find the note by matching file URL
    const note = await Note.findOne({ fileUrl: { $regex: filename } });

    if (!note) return res.status(404).json({ message: 'Note not found' });

    // Check if user is owner or in sharedWith
    const userId = req.user.id;
    const hasAccess =
      note.uploadedBy.toString() === userId ||
      note.sharedWith.some(u => u.toString() === userId);

    if (!hasAccess) {
      return res.status(403).json({ message: 'Unauthorized to download this note' });
    }

    res.download(filePath, filename, err => {
      if (err) res.status(500).json({ message: 'File download failed', error: err });
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ Delete a note by ID
router.delete('/delete/:id', authMiddleware, deleteNote);

// ✅ Share note by ID
router.post('/share/:id', authMiddleware, shareNote);

module.exports = router;
