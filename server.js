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
const notificationRoutes = require('./routes/notifications');

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

// In-memory map for connected sockets - Map of userId -> Set of socketIds
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
app.use('/api/notifications', notificationRoutes);

// -------------------
// Socket.IO Events
// -------------------
io.on('connection', (socket) => {
  console.log('User connected to socket:', socket.id);
  
  socket.on('register', (userId) => {
    const userIdStr = String(userId);
    console.log(`User ${userIdStr} registered with socket ${socket.id}`);
    
    // Join user-specific room
    socket.join(userIdStr);
    
    // Track user in connectedUsers map
    if (!connectedUsers.has(userIdStr)) {
      connectedUsers.set(userIdStr, new Set());
    }
    connectedUsers.get(userIdStr).add(socket.id);
    
    // Store userId on socket for cleanup
    socket.userId = userIdStr;
    
    console.log('Socket rooms:', Array.from(socket.rooms));
    console.log(`Connected users count for ${userIdStr}:`, connectedUsers.get(userIdStr).size);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected from socket:', socket.id);
    
    // Clean up connectedUsers map
    if (socket.userId) {
      const userSockets = connectedUsers.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          connectedUsers.delete(socket.userId);
        }
      }
    }
  });

  socket.on('chat-message', async (msg, callback) => {
    console.log('[SOCKET][CHAT] Received chat-message:', msg);
    
    try {
      const toId = String(msg.to);
      const fromId = String(msg.from);
      
      // Persist message to database
      const message = new Message({
        from: fromId,
        to: toId,
        text: msg.text,
        timestamp: msg.timestamp || new Date(),
      });
      await message.save();
      console.log('[SOCKET][CHAT] Message saved to database');
      
      // Send to recipient only (not back to sender)
      io.to(toId).emit('chat-message', {
        ...msg,
        _id: message._id,
        timestamp: message.timestamp
      });
      
      // Don't send back to sender - frontend handles it optimistically
      
      console.log(`[SOCKET][CHAT] Message sent to recipient: ${toId}`);
      
      // Send acknowledgment back to sender
      if (callback) {
        callback({ success: true, messageId: message._id });
      }
      
    } catch (err) {
      console.error('[SOCKET][CHAT] Error handling chat message:', err);
      
      if (callback) {
        callback({ error: err.message });
      }
      
      socket.emit('chat-error', { message: 'Failed to send message' });
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
