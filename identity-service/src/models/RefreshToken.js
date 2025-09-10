const mongoose = require('mongoose');
const refreshTokenSchema = new mongoose.Schema({

    token: {
        type: String,
        required: true,
        unique: true,
    },
    team: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
        required: true,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
}, {
    timestamps: true,
});

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const RefreshToken =mongoose.model('RefreshToken',refreshTokenSchema);
module.exports = RefreshToken;