const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const Note = require('../models/Note');
const User = require('../models/User');

// Upload a new note
exports.uploadNote = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "File is required" });
    }

    const { title, description, courseCode, instructor } = req.body;
    const uploadedBy = req.user._id;
    const fileUrl = `${req.protocol}://${req.get("host")}/api/notes/download/${req.file.filename}`;

    const note = await Note.create({ 
      title, 
      description, 
      courseCode, 
      instructor, 
      uploadedBy, 
      fileUrl 
    });
    
    return res.status(201).json(note);
  } catch (err) {
    console.error('Error uploading note:', err);
    return res.status(500).json({ message: err.message });
  }
};

// Get all notes for the user
exports.getNotes = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    
    const notes = await Note.find({
      $or: [
        { uploadedBy: userId },
        { 'sharedWith.recipient': userId }
      ]
    }).populate("uploadedBy", "email name");
    
    return res.json(notes);
  } catch (err) {
    console.error('Error fetching notes:', err);
    return res.status(500).json({ message: "Error fetching notes" });
  }
};

// Share a note with another user
exports.shareNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail, email } = req.body; // Support both formats
    const recipientEmail = email || userEmail;

    if (!recipientEmail) {
      return res.status(400).json({ message: "Recipient email is required" });
    }

    const user = await User.findOne({ email: recipientEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const note = await Note.findById(id);
    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    const userId = req.user.id || req.user._id;
    if (note.uploadedBy.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not allowed to share this note" });
    }

    // Initialize sharedWith if undefined
    if (!note.sharedWith) note.sharedWith = [];

    // Prevent duplicate shares
    const alreadyShared = note.sharedWith.some(share => {
      const recipientId = share.recipient ? share.recipient.toString() : share.toString();
      return recipientId === user._id.toString();
    });

    if (!alreadyShared) {
      note.sharedWith.push({ recipient: user._id });
      await note.save();

      // Notify recipient via socket
      notifyUser(req.app, user._id, 'note-shared', { 
        noteId: note._id, 
        from: userId 
      });
    }

    return res.json({ 
      message: "Note shared successfully",
      user: {
        _id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (err) {
    console.error('Error sharing note:', err);
    return res.status(500).json({ message: "Error sharing note" });
  }
};

// Delete a note
exports.deleteNote = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Check ownership
    const userId = req.user.id || req.user._id;
    const ownerId = note.uploadedBy?.toString();
    if (ownerId !== userId.toString()) {
      return res.status(403).json({ message: 'Not allowed to delete this note' });
    }

    // Delete the file
    await deleteNoteFile(note.fileUrl);

    // Get shared users before deleting the note
    const sharedUserIds = (note.sharedWith || [])
      .map(sw => sw.recipient ? sw.recipient.toString() : sw.toString())
      .filter(Boolean);

    // Delete the note document
    await note.deleteOne();

    // Notify shared users (once per user)
    const recipients = new Set(sharedUserIds);
    recipients.forEach(recipientId => {
      notifyUser(req.app, recipientId, 'note-deleted', { noteId: note._id });
    });

    return res.json({ message: 'Note deleted successfully' });
  } catch (err) {
    console.error('Failed to delete note', req.params.id, err);
    return res.status(500).json({ message: 'Failed to delete note' });
  }
};

// Helper to delete the file associated with a note
async function deleteNoteFile(fileUrl) {
  if (!fileUrl) return;

  try {
    let filename;
    try {
      const parsed = new URL(fileUrl);
      filename = path.basename(parsed.pathname);
    } catch {
      filename = path.basename(fileUrl);
    }

    if (!filename) return;

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    let fileToDelete = null;

    const candidates = [filename];
    try {
      const decoded = decodeURIComponent(filename);
      if (decoded !== filename) candidates.push(decoded);
    } catch {}

    for (const candidate of candidates) {
      const filePath = path.join(uploadsDir, candidate);
      try {
        await fsp.access(filePath, fs.constants.F_OK);
        fileToDelete = filePath;
        break;
      } catch {}
    }

    if (!fileToDelete) {
      try {
        const prefix = filename.split('-')[0];
        const files = await fsp.readdir(uploadsDir);
        const match = files.find(f => f.startsWith(prefix));
        if (match) fileToDelete = path.join(uploadsDir, match);
      } catch (err) {
        console.error('Failed to read uploads directory:', err);
      }
    }

    if (fileToDelete) {
      await fsp.unlink(fileToDelete);
      console.log('Deleted file:', fileToDelete);
    } else {
      console.warn('File not found for deletion:', filename);
    }
  } catch (err) {
    console.error('Error deleting file:', err);
  }
}

// Helper to notify users via sockets (fixed: no duplicates)
function notifyUser(app, userId, event, payload) {
  try {
    const io = app.get('io');
    if (!io) return;

    const connectedUsers = app.get('connectedUsers');

    if (connectedUsers) {
      const sockets = connectedUsers.get(String(userId));
      if (sockets instanceof Set) {
        for (const sid of sockets) {
          io.to(sid).emit(event, payload);
        }
        console.log(`[SOCKET] Emitted ${event} to user (sockets):`, userId);
        return; // prevent double emit
      } else if (typeof sockets === 'string') {
        io.to(sockets).emit(event, payload);
        console.log(`[SOCKET] Emitted ${event} to user (single socket):`, userId);
        return;
      }
    }

    // fallback: emit to room named after userId only if no connectedSockets found
    io.to(userId.toString()).emit(event, payload);
    console.log(`[SOCKET] Emitted ${event} to user (room fallback):`, userId);

  } catch (err) {
    console.error(`[SOCKET] Error emitting ${event}:`, err);
  }
}
