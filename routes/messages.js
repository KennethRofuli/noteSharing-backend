// Add this endpoint to mark messages as read:

router.post('/mark-read/:userId', auth, async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const otherUserId = req.params.userId;
    
    // Update all messages from this user as read
    await Message.updateMany(
      {
        senderId: otherUserId,
        recipientId: currentUserId,
        read: false
      },
      {
        read: true,
        readAt: new Date()
      }
    );
    
    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    res.status(500).json({ message: 'Error marking messages as read' });
  }
});