const User = require('../models/User');

// GET /api/chat/users?search= (returns verified users or search by email)
exports.getChatUsers = async (req, res) => {
  try {
    const { search } = req.query;
    let users;
    if (search && search.trim()) {
      users = await User.find({
        email: { $regex: search.trim(), $options: 'i' },
        verified: true,
        _id: { $ne: req.user._id }
      }).select('_id email name');
    } else {
      users = await User.find({
        verified: true,
        _id: { $ne: req.user._id }
      }).select('_id email name');
    }
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching users' });
  }
};