import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IMedia extends Document {
  _id: mongoose.Types.ObjectId;
  publicId: string;
  originalName: string;
  mimeType: string;
  url: string;
  teamId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One row per successful Cloudinary upload. Written by `uploadMedia` and read in bulk
 * by `getAllMedia`; nothing else in the system touches this collection.
 *
 * D-MD-05: `teamId` keeps its `ObjectId, ref: 'User'` declaration even though no `User`
 * model exists anywhere in the system and every other service stores team ids as plain
 * `String` (architecture doc issue 2). The `ref` is inert — nothing calls `.populate()`
 * on it — but the ObjectId *type* is load-bearing: it is what casts the `x-team-id`
 * header string on the way in, and `teamId.toString()` on the way back out is what the
 * `profilePhoto.updated` payload carries.
 */
const mediaSchema = new Schema<IMedia>(
  {
    publicId: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    url: { type: String, required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

export const Media: Model<IMedia> = mongoose.model<IMedia>('Media', mediaSchema);
