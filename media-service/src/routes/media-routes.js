const express = require('express');
const multer = require('multer');

const {authenticateRequest}=require('../middleware/authMiddleware');
const { uploadMedia,getAllMedia } = require('../controllers/media-controller');
const logger = require('../utils/logger');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(), // Store files in memory for processing
    limits: { fileSize: 10 * 1024 * 1024 } // Limit file size to 10MB
}).single('file')

router.post('/upload-logo', authenticateRequest,(req, res,next) => {
        logger.info('Received request to upload-logo media');
        upload(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            logger.error(' Multer Error uploading file:', err);
            return res.status(400).json({ message: 'File upload error', error: err.message });
        }
        else if (err) {
            logger.error(' Unknown Error uploading file:', err);
            return res.status(500).json({ message: 'Internal Server Error', error: err.message });
        }
        if(!req.file){
        logger.warn('No file uploaded');
        return res.status(400).json({ message: 'No file uploaded' });
        }
      next();
    });
    
  


}, uploadMedia);


router.get('/get', authenticateRequest, getAllMedia);





module.exports = router;




