require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const noteRoutes = require('./routes/notes');
const userRoutes = require('./routes/user');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const connectedUsers = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads')); // serve uploaded files

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/users', require('./routes/user'));
const chatRouter = require('./routes/chat');
app.use('/api/chat', chatRouter);

// Socket.io
io.on('connection', (socket) => {
  socket.on('register', userId => {
    connectedUsers.set(userId, socket.id);
    console.log('[SOCKET][REGISTER] Registered', userId, 'with socket', socket.id);
  });

  socket.on('chat-message', async (msg) => {
    // --- Add these debug logs ---
    console.log('[SOCKET][CHAT] Received chat-message:', msg);
    const recipientSocketId = connectedUsers.get(msg.to);
    console.log('[SOCKET][CHAT] recipientSocketId:', recipientSocketId);
    // --- End debug logs ---

    // Save to DB
    try {
      await Message.create({
        from: msg.from,
        to: msg.to,
        text: msg.text,
        timestamp: msg.timestamp || new Date()
      });
    } catch (err) {
      console.error('Failed to save message:', err);
    }
    // Send to recipient
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('chat-message', msg);
    }
  });

  socket.on('disconnect', () => {
    // Remove user from map on disconnect
    for (const [userId, sockId] of connectedUsers.entries()) {
      if (sockId === socket.id) {
        connectedUsers.delete(userId);
        break;
      }
    }
  });
});

// Make io accessible in controllers
app.set('io', io);
app.set('connectedUsers', connectedUsers);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error(err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = { connectedUsers };
