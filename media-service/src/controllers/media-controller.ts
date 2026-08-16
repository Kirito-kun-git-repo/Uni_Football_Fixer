import type { Request, Response } from 'express';
import type { Logger } from '@uff/shared/logger';
import { publishEvent } from '@uff/shared/rabbitmq';
import { Media } from '../models/Media.js';
import { createCloudinaryClient } from '../utils/cloudinary.js';

/**
 * Controllers are built by a factory so the logger is injected rather than imported as
 * a module singleton (D-MD-02), matching identity-service. Called once, from
 * `routes/media-routes.ts`.
 */
export function createMediaController(logger: Logger) {
  const cloudinaryClient = createCloudinaryClient(logger);

  /**
   * The only write path in the service, and the only publisher on the bus.
   *
   * Everything upstream of it has already run by the time it is reached: the rate
   * limiter, `createAuthenticateRequest` (which is what puts `req.team` there), and
   * multer's wrapper in `media-routes.ts` — the wrapper also handles the missing-file
   * and multer-error cases, so the `!mediaFile` guard below is only reached if that
   * wrapper's own check is ever removed.
   */
  const uploadMedia = async (req: Request, res: Response): Promise<void> => {
    logger.info('Upload media request received');
    try {
      const mediaFile = req.file;
      if (!mediaFile) {
        logger.warn('No media file uploaded');
        res.status(400).json({ message: 'No media file uploaded' });
        return;
      }

      const { originalname, mimetype } = mediaFile;
      // `req.team` is set by `createAuthenticateRequest`, which is mounted on this
      // route ahead of the controller — the assertion documents that ordering rather
      // than a belief that the header is trustworthy. It is not; backlog item 1.
      const teamId = req.team!.teamId;
      logger.info(
        `Team ID: ${teamId}, Original File Name: ${originalname}, MIME Type: ${mimetype}`,
      );
      logger.info('Uploading media to Cloudinary...');

      const cloudinaryUploadResult = await cloudinaryClient.uploadMediaToCloudinary(mediaFile);
      // D-MD-07: `public_Id` is a typo for `public_id` and always logs `undefined`.
      // Reproduced rather than fixed, per the behaviour-preserving rule; it compiles
      // only because Cloudinary's response type carries an `[futureKey: string]: any`
      // index signature. Architecture doc issue 7.
      logger.info(
        `Media uploaded successfully to Cloudinary: ${cloudinaryUploadResult.public_Id}`,
      );
      // D-MD-07: debug statement left in the original, bypassing the winston logger.
      // Reproduced for the same reason. Architecture doc issue 8.
      console.log(req.file);

      const newlyCreatedMedia = new Media({
        publicId: cloudinaryUploadResult.public_id,
        url: cloudinaryUploadResult.secure_url,
        originalName: originalname,
        teamId: teamId,
        mimeType: mimetype,
      });
      await newlyCreatedMedia.save();

      // identity-service consumes this on queue `identity.profilePhoto.updated` and
      // writes the url onto `Team.logoUrl`. Both fields are stringified at this call
      // site because `teamId` is a Mongoose ObjectId, not a string — the typed
      // contract in `@uff/shared/events` requires `string` on both.
      await publishEvent('profilePhoto.updated', {
        url: newlyCreatedMedia.url.toString(),
        teamId: newlyCreatedMedia.teamId.toString(),
      });
      logger.info('Publishing event for profile photo update...');

      logger.info('Media saved to database successfully');
      res.status(201).json({
        message: 'Media uploaded successfully',
        mediaId: newlyCreatedMedia._id,
        publicId: newlyCreatedMedia.publicId,
        url: newlyCreatedMedia.url,
        teamId: newlyCreatedMedia.teamId,
      });
    } catch (error) {
      logger.error('Error uploading media:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  /**
   * Returns every media document in the collection — no `teamId` filter, no pagination
   * (architecture doc issue 1). Preserved exactly, including the capitalised `Result`
   * response key, which any existing client is keyed to.
   */
  const getAllMedia = async (_req: Request, res: Response): Promise<void> => {
    try {
      const Result = await Media.find({});
      res.json({ Result });
    } catch (error) {
      logger.error('Error fetching media:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  return { uploadMedia, getAllMedia };
}
