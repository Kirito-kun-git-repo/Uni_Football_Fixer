const cloudinary = require('cloudinary').v2;
const { error } = require('winston');
const logger = require('./logger');
require('dotenv').config();




cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
})

const uploadMediaToCloudinary = async (filePath) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: 'auto',
            },
            (error, result) => {
                if (error) {
                    logger.error('Error while Uploading media to Cloudinary:', error);
                    return reject(error);
                }
                else{
                    resolve(result);
                    logger.info('Media uploaded successfully to Cloudinary:', result);
                }
            }
        )
        uploadStream.end(filePath.buffer); // Assuming filePath is a buffer
    });
};


const deleteMediaFromCloudinary = async (publicId) => {
    try{
        const result = await cloudinary.uploader.destroy(publicId);
        logger.info('Media deleted successfully from Cloudinary:', publicId);
        return result;

    }catch(error) {
        logger.error('Error while deleting media from Cloudinary:', error);
        throw error;
    }
}
module.exports = { uploadMediaToCloudinary, deleteMediaFromCloudinary };
    