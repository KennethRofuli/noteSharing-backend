// routes/note.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const router = express.Router();

const Note = require('../models/Note');
const {
  uploadNote,
  getNotes,
  shareNote,
  deleteNote
} = require('../controllers/noteController');
const authMiddleware = require('../middleware/auth');

// ✅ Allowed extensions for uploads
const allowedExtensions = [
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip"
];

// ✅ Max upload size (bytes) - default 20 MB or override with env
const MAX_FILE_SIZE = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024;

// ✅ Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Uploads dir ready:', uploadsDir);
} catch (err) {
  console.error('Failed to create uploads dir', uploadsDir, err);
}

// ✅ Multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
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
    return cb(
      new Error(`File type not allowed. Allowed extensions: ${allowedExtensions.join(', ')}`),
      false
    );
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// ======================= ROUTES ======================= //

// ✅ Upload a note
router.post(
  '/upload',
  authMiddleware,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            message: `File too large. Max size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB`
          });
        }
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  uploadNote
);

// ✅ Get all notes (for current user)
router.get('/', authMiddleware, getNotes);

// ✅ Download a note (only owner or shared recipient can download)
router.get('/download/:filename', authMiddleware, async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);

  try {
    // Find note document by fileUrl containing filename
    const note = await Note.findOne({ fileUrl: { $regex: filename } });
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Auth check
    const userId = req.user.id;
    const isOwner = note.uploadedBy && note.uploadedBy.toString() === userId;
    const isShared = (note.sharedWith || []).some(sw =>
      sw && sw.recipient && String(sw.recipient) === String(userId)
    );

    if (!isOwner && !isShared) {
      return res.status(403).json({ message: 'Unauthorized to download this note' });
    }

    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('File download failed', err);
        return res.status(500).json({ message: 'File download failed', error: err.message || err });
      }
    });
  } catch (err) {
    console.error('Download error', err);
    res.status(500).json({ message: err.message });
  }
});

// ✅ Delete note
router.delete('/delete/:id', authMiddleware, deleteNote);

// ✅ Share note
router.post('/share/:id', authMiddleware, shareNote);

// POST /api/notes/unshare/:id - Remove a note from current user's shared list
router.post('/unshare/:id', authMiddleware, async (req, res) => {
  try {
    const noteId = req.params.id;
    const userId = req.user._id;

    const note = await Note.findById(noteId);
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Filter out the current user from sharedWith array
    note.sharedWith = note.sharedWith.filter(share => {
      const recipientId = share.recipient ? share.recipient.toString() : share.toString();
      return recipientId !== userId.toString();
    });

    await note.save();
    
    res.json({ message: 'Note removed from your shared list' });
  } catch (err) {
    console.error('Error unsharing note:', err);
    res.status(500).json({ message: 'Server error while unsharing note' });
  }
});

module.exports = router;
