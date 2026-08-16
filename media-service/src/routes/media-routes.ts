import { Router } from 'express';
import { env } from '../env.js';
import multer from 'multer';
import type { Logger } from '@uff/shared/logger';
import { createAuthenticateRequest } from '@uff/shared/auth';
import { createMediaController } from '../controllers/media-controller.js';

/**
 * Mounted at `/api/media` by server.ts, behind the rate limiter that is mounted on the
 * same prefix one line earlier. The gateway rewrites `/v1/media/*` to `/api/media/*`
 * and forwards the multipart body untouched.
 */
export function createMediaRouter(logger: Logger): Router {
  const router = Router();
  const controller = createMediaController(logger);
  // `createAuthenticateRequest`, NOT `createValidateToken`: this service trusts the
  // `x-team-id` header the gateway injected and verifies no JWT of its own.
  const authenticateRequest = createAuthenticateRequest(logger, env.INTERNAL_SECRET);

  /**
   * `memoryStorage` means the entire upload is buffered in the process before
   * Cloudinary is called — N concurrent uploads hold N × 10 MB resident (issue 9).
   * There is no `fileFilter`, so any mimetype is accepted as a "logo" (issue 3).
   */
  const uploader: multer.Multer = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  const upload = uploader.single('file');

  /**
   * multer is invoked manually inside a wrapper rather than mounted as middleware, so
   * that its three failure modes get distinct responses before `uploadMedia` is ever
   * reached: a `MulterError` (the 10 MB limit, wrong field name) is a 400, any other
   * throw is a 500, and a request that parsed cleanly but carried no `file` field is a
   * 400 with a different body shape (issue 15). Only the clean path calls `next()`,
   * which is what hands control to the controller registered after this handler.
   */
  router.post(
    '/upload-logo',
    authenticateRequest,
    (req, res, next) => {
      logger.info('Received request to upload-logo media');
      upload(req, res, (err?: unknown) => {
        if (err instanceof multer.MulterError) {
          logger.error(' Multer Error uploading file:', err);
          res.status(400).json({ message: 'File upload error', error: err.message });
          return;
        }
        if (err) {
          logger.error(' Unknown Error uploading file:', err);
          res.status(500).json({
            message: 'Internal Server Error',
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        if (!req.file) {
          logger.warn('No file uploaded');
          res.status(400).json({ message: 'No file uploaded' });
          return;
        }
        next();
      });
    },
    controller.uploadMedia,
  );

  router.get('/get', authenticateRequest, controller.getAllMedia);

  return router;
}
