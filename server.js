require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const noteRoutes = require('./routes/notes');
const userRoutes = require('./routes/user');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);

// Allowed frontend origins (exact, no trailing slash)
const allowedOrigins = [
  "http://localhost:5173",
  "https://note-sharing-frontend.vercel.app"
];

// Middleware
app.use(cors({
  origin: (origin, cb) => {
    // allow Postman / curl requests (no origin)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    console.warn('[CORS] blocked origin:', origin);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/users', userRoutes);
const chatRouter = require('./routes/chat');
app.use('/api/chat', chatRouter);

// TEMP ROUTE: Emit test events to a specific user
app.get('/test-emit/:userId', (req, res) => {
  const io = req.app.get('io');
  const connectedUsers = req.app.get('connectedUsers');
  const userId = req.params.userId;

  if (!io || !connectedUsers) {
    return res.status(500).send("Socket.IO not initialized");
  }

  emitToUserSockets(io, connectedUsers, userId, 'note-shared', {
    noteId: 'TEST_NOTE_ID',
    from: 'TEST_SENDER_ID'
  });

  emitToUserSockets(io, connectedUsers, userId, 'note-deleted', {
    noteId: 'TEST_NOTE_ID'
  });

  res.send(`Test events emitted to user ${userId}`);
});


// Socket.IO
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// in-memory socket map
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('[SOCKET] connected', socket.id);

  socket.on('register', (userId) => {
    const uid = String(userId);
    const set = connectedUsers.get(uid) || new Set();
    set.add(socket.id);
    connectedUsers.set(uid, set);
    console.log('[SOCKET] register', uid, socket.id);
  });

  socket.on('disconnect', () => {
    for (const [uid, set] of connectedUsers.entries()) {
      if (set.has(socket.id)) {
        set.delete(socket.id);
        if (set.size === 0) connectedUsers.delete(uid);
        else connectedUsers.set(uid, set);
        console.log('[SOCKET] removed mapping', uid);
      }
    }
    console.log('[SOCKET] disconnected', socket.id);
  });

  socket.on('chat-message', async (msg) => {
    const toId = String(msg.to);
    const sockets = connectedUsers.get(toId);

    try {
      const message = new Message({
        from: msg.from,
        to: msg.to,
        text: msg.text,
        timestamp: msg.timestamp || Date.now()
      });
      await message.save();
    } catch (err) {
      console.error('[SOCKET][CHAT] failed saving message', err);
    }

    if (sockets && sockets.size) {
      for (const sid of sockets) {
        io.to(sid).emit('chat-message', msg);
      }
    }
  });
});

// Expose io in controllers
app.set('io', io);
app.set('connectedUsers', connectedUsers);

// MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = { connectedUsers };
