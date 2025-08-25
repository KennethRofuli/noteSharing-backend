require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// Routes
const authRoutes = require('./routes/auth');
const noteRoutes = require('./routes/notes');
const userRoutes = require('./routes/user');
const chatRouter = require('./routes/chat');

// Models
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);

// -------------------
// CORS Setup
// -------------------
const allowedOrigins = [
  'http://localhost:5173',
  'https://note-sharing-frontend.vercel.app'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser clients like Postman
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS not allowed for this origin'));
  },
  credentials: true
}));

// -------------------
// Socket.IO Setup
// -------------------
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// In-memory map for connected sockets
const connectedUsers = new Map();

// -------------------
// Redis adapter for Socket.IO (Upstash) if REDIS_URL exists
// -------------------
if (process.env.REDIS_URL) {
  const { createAdapter } = require('@socket.io/redis-adapter');
  const { createClient } = require('redis');

  const pubClient = createClient({
    url: process.env.REDIS_URL,
    socket: { tls: true, rejectUnauthorized: false }
  });
  const subClient = pubClient.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[SOCKET] Redis adapter connected (Upstash)');
    })
    .catch(err => console.error('[SOCKET] Redis connection failed', err));
} else {
  console.log('[SOCKET] Using in-memory socket map (local dev)');
}

// -------------------
// Middleware
// -------------------
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// -------------------
// Routes
// -------------------
app.use('/api/auth', authRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRouter);

// -------------------
// Socket.IO Events
// -------------------
io.on('connection', (socket) => {
  console.log('[SOCKET] connected', socket.id);

  socket.on('register', (userId) => {
    const uid = String(userId);
    const set = connectedUsers.get(uid) || new Set();
    set.add(socket.id);
    connectedUsers.set(uid, set);
    console.log('[SOCKET] register', uid, '->', socket.id, 'mapSize=', connectedUsers.size);
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
    console.log('[SOCKET] disconnect', socket.id, 'mapSize=', connectedUsers.size);
  });

  socket.on('chat-message', async (msg) => {
    console.log('[SOCKET][CHAT] Received chat-message:', msg);
    const toId = String(msg.to);
    const sockets = connectedUsers.get(toId);
    console.log('[SOCKET][CHAT] recipientSockets:', sockets);

    // persist message
    try {
      const message = new Message({
        from: msg.from,
        to: msg.to,
        text: msg.text,
        timestamp: msg.timestamp || Date.now(),
      });
      await message.save();
    } catch (err) {
      console.error('[SOCKET][CHAT] failed saving message', err);
    }

    if (sockets && sockets.size) {
      for (const sid of sockets) io.to(sid).emit('chat-message', msg);
    }
  });
});

// Expose io and connectedUsers to controllers
app.set('io', io);
app.set('connectedUsers', connectedUsers);

// -------------------
// MongoDB Connection
// -------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error(err));

// -------------------
// Start Server
// -------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = { connectedUsers };
