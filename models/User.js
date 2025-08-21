const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  verificationToken: { type: String, default: null },
  isVerified: { type: Boolean, default: false }, // false until email is verified
  verificationExpiry: { 
    type: Date,
    default: function() {
      // Only set expiry if NOT verified
      if (!this.isVerified) {
        // in production: 24h
        return Date.now() + 1 * 60 * 1000;
      }
      return undefined; // verified users won't have expiry
    }
  }
});

// TTL index for auto-delete (only applies if field exists)
userSchema.index({ verificationExpiry: 1 }, { expireAfterSeconds: 0 });

// --- new: remove verificationExpiry field when user is verified ---
userSchema.pre('save', function(next) {
  if (this.isVerified && this.verificationExpiry) {
    // ensure the field is removed from the document so the TTL index won't apply
    this.verificationExpiry = undefined;
  }
  next();
});
// --------------------------------------------------------------------

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to mark verified and stop expiry
userSchema.methods.verifyEmail = async function() {
  this.isVerified = true;
  this.verificationToken = null;

  // Save with isVerified = true
  await this.save();

  // Extra safety: actually remove expiry in DB
  await this.constructor.updateOne(
    { _id: this._id },
    { $unset: { verificationExpiry: "" } }
  );
};

module.exports = mongoose.model('User', userSchema);
