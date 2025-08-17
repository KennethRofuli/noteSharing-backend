const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String },
    courseCode: { type: String, required: true },
    instructor: { type: String },
    fileUrl: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    votes: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Note', noteSchema);
