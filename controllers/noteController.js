const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const Note = require('../models/Note');
const User = require('../models/User');

exports.uploadNote = async (req, res) => {
  const { title, description, courseCode, instructor } = req.body;
  const uploadedBy = req.user._id;

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
        { 'sharedWith.recipient': req.user.id }
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
    const { id } = req.params;
    const { userEmail } = req.body;

    const user = await User.findOne({ email: userEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    const note = await Note.findById(id);
    if (!note) return res.status(404).json({ message: "Note not found" });

    if (note.uploadedBy.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not allowed to share this note" });
    }

    const alreadyShared = (note.sharedWith || []).some(sw =>
      (sw.recipient && sw.recipient.toString() === user._id.toString())
    );

    if (!alreadyShared) {
      note.sharedWith.push({ recipient: user._id });
      await note.save();

      // emit socket
      try {
        const io = req.app.get('io');
        const connectedUsers = req.app.get('connectedUsers');
        emitToUserSockets(io, connectedUsers, user._id, 'note-shared', { noteId: note._id, from: req.user._id });
      } catch (err) {
        console.error('[NOTE_CONTROLLER] share emit error', err);
      }
    }

    return res.json({ message: "Note shared successfully" });
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

    const ownerId = note.uploadedBy?.toString();
    if (ownerId !== req.user.id) return res.status(403).json({ message: 'Not allowed to delete this note' });

    // resolve filename
    let filename = null;
    if (note.fileUrl) {
      try {
        const parsed = new URL(note.fileUrl);
        filename = path.basename(parsed.pathname);
      } catch {
        filename = path.basename(note.fileUrl);
      }
    }

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    let fileToDelete = null;

    if (filename) {
      const candidates = [filename];

      try {
        const decoded = decodeURIComponent(filename);
        if (decoded !== filename) candidates.push(decoded);
      } catch {}

      for (const cand of candidates) {
        const p = path.join(uploadsDir, cand);
        try {
          await fsp.access(p, fs.constants.F_OK);
          fileToDelete = p;
          break;
        } catch {}
      }

      if (!fileToDelete) {
        const prefix = filename.split('-')[0];
        try {
          const files = await fsp.readdir(uploadsDir);
          const match = files.find(f => f.startsWith(prefix));
          if (match) fileToDelete = path.join(uploadsDir, match);
        } catch (e) {
          console.error('Failed to read uploads dir', uploadsDir, e);
        }
      }
    }

    if (fileToDelete) {
      try {
        await fsp.unlink(fileToDelete);
        console.log('Deleted file:', fileToDelete);
      } catch (err) {
        console.error('Error deleting file:', fileToDelete, err);
      }
    } else {
      console.warn('File not found for deletion:', filename);
    }

    const sharedUserIds = (note.sharedWith || []).map(sw => sw.recipient?.toString()).filter(Boolean);
    await note.deleteOne();

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');

    console.log('[SOCKET][DELETE] sharedUserIds:', sharedUserIds);

    if (io && connectedUsers && sharedUserIds.length) {
      sharedUserIds.forEach(uid => {
        emitToUserSockets(io, connectedUsers, uid, 'note-deleted', { noteId: note._id });
      });
    }

    return res.json({ message: 'Note deleted successfully' });
  } catch (err) {
    console.error('Failed to delete note', req.params.id, err);
    return res.status(500).json({ message: 'Failed to delete note' });
  }
};

// helper
function emitToUserSockets(io, connectedUsers, userId, event, payload) {
  try {
    const sockets = connectedUsers.get(String(userId));
    if (!sockets) return;

    if (sockets instanceof Set) {
      for (const sid of sockets) {
        io.to(sid).emit(event, payload);
      }
    } else if (typeof sockets === 'string') {
      io.to(sockets).emit(event, payload);
    }
  } catch (err) {
    console.error('[NOTE_CONTROLLER] emitToUserSockets error', err);
  }
}
