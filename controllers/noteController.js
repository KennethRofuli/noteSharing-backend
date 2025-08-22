const fs = require('fs');
const path = require('path');
const Note = require('../models/Note');
const User = require('../models/User');

exports.uploadNote = async (req, res) => {
  const { title, description, courseCode, instructor } = req.body;
  const uploadedBy = req.user._id; // <-- use logged-in user

  if (!req.file) return res.status(400).json({ message: "File is required" });

  const fileUrl = `${req.protocol}://${req.get("host")}/api/notes/download/${req.file.filename}`;

  try {
    const note = await Note.create({ title, description, courseCode, instructor, uploadedBy, fileUrl });
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.getNotes = async (req, res) => {
  try {
    const notes = await Note.find({
      $or: [
        { uploadedBy: req.user.id },
        { 'sharedWith.recipient': req.user.id } // <-- updated for subdocs
      ]
    }).populate("uploadedBy", "email name");
    res.json(notes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching notes" });
  }
};

// POST /notes/share/:id
exports.shareNote = async (req, res) => {
  try {
    const { id } = req.params; // note id
    const { userEmail } = req.body;

    // Find user by email
    const user = await User.findOne({ email: userEmail });
    if (!user) return res.status(404).json({ message: "User not found" });
    // Find note by id
    const note = await Note.findById(id);
    if (!note) return res.status(404).json({ message: "Note not found" });

    // ✅ only owner can share
    if (note.uploadedBy.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not allowed to share this note" });
    }

    // ✅ avoid duplicates
    const alreadyShared = (note.sharedWith || []).some(sw =>
      (sw.recipient && sw.recipient.toString() === user._id.toString()) ||
      (sw._id && sw._id.toString() === user._id.toString()) // fallback for legacy
    );
    if (!alreadyShared) {
      note.sharedWith.push({ recipient: user._id });
      await note.save();
    }

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');

    const recipientId = user._id.toString();
    const recipientSocketId = connectedUsers.get(recipientId);

    // Debug logs
    //console.log('[SOCKET][SHARE] recipientId:', recipientId);
    //console.log('[SOCKET][SHARE] connectedUsers:', connectedUsers);
    //console.log('[SOCKET][SHARE] recipientSocketId:', recipientSocketId);

    if (io && recipientSocketId) {
      io.to(recipientSocketId).emit('note-shared', { noteId: note._id });
      console.log('[SOCKET][SHARE] Emitted note-shared to socket:', recipientSocketId);
    } else {
      console.log('[SOCKET][SHARE] No socket emission (io or recipientSocketId missing)');
    }

    res.json({ message: "Note shared successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error sharing note" });
  }
};

// DELETE /notes/delete/:id
exports.deleteNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Note not found' });

    const ownerId = note.uploadedBy?.toString ? note.uploadedBy.toString() : String(note.uploadedBy);
    if (ownerId !== req.user.id) return res.status(403).json({ message: 'Not allowed to delete this note' });

    let filename = null;
    if (note.fileUrl) {
      try {
        const parsed = new URL(note.fileUrl);
        filename = path.basename(parsed.pathname);
      } catch (e) {
        filename = path.basename(note.fileUrl);
      }
    }

    const uploadsDir = path.join(__dirname, '..', 'uploads');

    // try several candidate filenames (raw, decoded) and fallback to scanning uploads dir
    let fileToDelete = null;
    if (filename) {
      const candidates = [filename];

      // add decoded candidate if it looks URL-encoded
      try {
        const decoded = decodeURIComponent(filename);
        if (decoded !== filename) candidates.push(decoded);
      } catch (e) {
        // ignore malformed decode
      }

      // check each candidate exists
      for (const cand of candidates) {
        const p = path.join(uploadsDir, cand);
        try {
          await fs.promises.access(p, fs.constants.F_OK);
          fileToDelete = p;
          break;
        } catch (e) {
          // not found, continue
        }
      }

      // fallback: try to find file in uploads that starts with same timestamp/prefix
      if (!fileToDelete) {
        const prefix = filename.split('-')[0];
        try {
          const files = await fs.promises.readdir(uploadsDir);
          const match = files.find(f => f.startsWith(prefix));
          if (match) fileToDelete = path.join(uploadsDir, match);
        } catch (e) {
          console.error('Failed to read uploads dir', uploadsDir, e);
        }
      }
    } else {
      console.warn('No filename resolved for note', note._id, 'fileUrl:', note.fileUrl);
    }

    if (fileToDelete) {
      try {
        await fs.promises.unlink(fileToDelete);
        console.log('Deleted file:', fileToDelete);
      } catch (err) {
        console.error('Error deleting file:', fileToDelete, err);
        // non-fatal: continue to delete DB doc but log error
      }
    } else {
      console.warn('File not found for deletion (candidates tried):', filename, 'uploadsDir:', uploadsDir);
    }

    // Save sharedWith user IDs before deleting
    const sharedUserIds = (note.sharedWith || [])
      .map(sw => sw.recipient ? sw.recipient.toString() : (sw._id ? sw._id.toString() : sw.toString()))
      .filter(Boolean);

    await note.deleteOne();

    // Emit socket event to all shared users
    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');

    // Debug logs
    console.log('[SOCKET][DELETE] sharedUserIds:', sharedUserIds);
    console.log('[SOCKET][DELETE] connectedUsers:', connectedUsers);

    if (io && connectedUsers && sharedUserIds.length) {
      sharedUserIds.forEach(userId => {
        const socketId = connectedUsers.get(userId);
        console.log('[SOCKET][DELETE] userId:', userId, 'socketId:', socketId);
        if (socketId) {
          io.to(socketId).emit('note-deleted', { noteId: note._id });
          console.log('[SOCKET][DELETE] Emitted note-deleted to socket:', socketId);
        } else {
          console.log('[SOCKET][DELETE] No socket emission for userId:', userId);
        }
      });
    } else {
      console.log('[SOCKET][DELETE] No socket emission (io, connectedUsers, or sharedUserIds missing)');
    }

    console.log('Emitting note-deleted to:', sharedUserIds);

    return res.json({ message: 'Note deleted successfully' });
  } catch (err) {
    console.error('Failed to delete note', req.params.id, err);
    return res.status(500).json({ message: 'Failed to delete note' });
  }
};




