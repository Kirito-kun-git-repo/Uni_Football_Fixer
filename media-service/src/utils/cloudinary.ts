import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import type { Logger } from '@uff/shared/logger';
import { env } from '../env.js';

export interface CloudinaryClient {
  uploadMediaToCloudinary(file: Express.Multer.File): Promise<UploadApiResponse>;
  deleteMediaFromCloudinary(publicId: string): Promise<unknown>;
}

/**
 * Turns whatever the Cloudinary SDK hands back into a real `Error`.
 *
 * The SDK's failure value is a plain object literal, so `instanceof Error` is false
 * for it and every downstream consumer that branches on that — winston's
 * `format.errors`, the controller's catch, the shared error handler — treats it as
 * anonymous metadata rather than as a failure. `http_code` is carried across as a
 * property so nothing that was in the log before is lost.
 */
function normaliseCloudinaryError(error: unknown): Error {
  if (error instanceof Error) return error;

  const source = (error ?? {}) as { message?: unknown; name?: unknown; http_code?: unknown };
  const message =
    typeof source.message === 'string' && source.message.length > 0
      ? source.message
      : `Cloudinary upload failed: ${JSON.stringify(error)}`;

  const normalised = new Error(message);
  if (typeof source.name === 'string' && source.name.length > 0) {
    normalised.name = source.name;
  }
  if (source.http_code !== undefined) {
    Object.assign(normalised, { http_code: source.http_code });
  }
  return normalised;
}

/**
 * Configures the Cloudinary SDK and returns the two operations that wrap it.
 *
 * Built once, by `createMediaController`, which is itself built once by
 * `createMediaRouter`. `cloudinary.config()` mutates SDK-global state, so calling this
 * more than once per process is pointless but harmless.
 *
 * A factory rather than module-level code because `@uff/shared/logger` exports
 * `createLogger(serviceName)` rather than a ready-made instance — the logger has to be
 * injected from `server.ts` (D-MD-02).
 */
export function createCloudinaryClient(logger: Logger): CloudinaryClient {
  cloudinary.config({
    cloud_name: env.CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });

  /**
   * The whole file sits in memory before this runs — multer uses `memoryStorage`, so
   * `file.buffer` is the complete upload. `upload_stream` is callback-based, hence the
   * hand-rolled Promise; `resource_type: 'auto'` means Cloudinary sniffs the type
   * itself, which is why nothing here rejects a non-image "logo" (issue 3).
   */
  const uploadMediaToCloudinary = async (
    file: Express.Multer.File,
  ): Promise<UploadApiResponse> =>
    new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: 'auto' },
        (error, result) => {
          if (error) {
            // Cloudinary rejects with a PLAIN OBJECT, not an Error instance —
            // `{ message, name, http_code }`. Winston merges a plain object second
            // argument into the log meta, and its `message` key then OVERRIDES the
            // message passed as the first argument. Logging the raw object therefore
            // silently discarded the call-site prefix here and again in the
            // controller's catch, emitting two byte-identical `Invalid api_key ...`
            // lines with no indication of which frame produced either, and no stack
            // (`format.errors({ stack: true })` only applies to real Errors).
            // Normalising to an Error restores both prefixes and the stack, and is
            // what D-MD-06's "makes the cause legible in the log" intended. The
            // rejection still travels to the same controller catch and the client
            // still gets the same 500 — this is log-shape only.
            const cause = normaliseCloudinaryError(error);
            logger.error('Error while Uploading media to Cloudinary:', cause);
            reject(cause);
            return;
          }
          // D-MD-06: the original resolved `result` unconditionally. Cloudinary types
          // it as optional, and resolving `undefined` here only moved the failure one
          // frame later — the controller then read `.public_id` off undefined and its
          // catch turned it into the same 500. Rejecting keeps that response identical
          // while making the cause legible in the log.
          if (!result) {
            reject(new Error('Cloudinary upload returned no result'));
            return;
          }
          resolve(result);
          logger.info('Media uploaded successfully to Cloudinary:', result);
        },
      );
      uploadStream.end(file.buffer);
    });

  /**
   * Exported and never called. The only caller would have been the `post.deleted`
   * handler, which was fully commented out and is deleted by this port (D-MD-04).
   * Kept because it is working code, not dead code: it is the piece a future
   * "delete the previous logo" fix needs (issue 4).
   */
  const deleteMediaFromCloudinary = async (publicId: string): Promise<unknown> => {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      logger.info('Media deleted successfully from Cloudinary:', publicId);
      return result;
    } catch (error) {
      logger.error('Error while deleting media from Cloudinary:', error);
      throw error;
    }
  };

  return { uploadMediaToCloudinary, deleteMediaFromCloudinary };
}
