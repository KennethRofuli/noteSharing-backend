const mongoose = require('mongoose');

const SharedWithSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: false });

const noteSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String },
    courseCode: { type: String, required: true },
    instructor: { type: String },
    fileUrl: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sharedWith: { type: [SharedWithSchema], default: [] },
    votes: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Note', noteSchema);
