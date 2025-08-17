const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const router = express.Router();

const Note = require('../models/Note');
const { uploadNote, getNotes, shareNote, deleteNote } = require('../controllers/noteController');
const authMiddleware = require('../middleware/auth');

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
const upload = multer({ storage: storage });

// ✅ Routes
router.post('/upload', authMiddleware, upload.single('file'), uploadNote);
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
