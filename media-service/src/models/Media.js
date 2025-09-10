const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
    publicId:{
        type: String,
        required: true,
        unique: true
    },
    originalName: {
        type: String,
        required: true  
    },
    mimeType: {
        type: String,
        required: true
    },
    url: {
        type: String,
        required: true
    },
    teamId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
},{timestamps: true});
const Media = mongoose.model('Media', mediaSchema);
module.exports = Media;
