import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IRefreshToken extends Document {
  _id: mongoose.Types.ObjectId;
  token: string;
  team: mongoose.Types.ObjectId;
  expiresAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    token: { type: String, required: true, unique: true },
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

/**
 * TTL index — Mongo reaps expired refresh tokens without any application sweep.
 * The controller still checks `expiresAt` explicitly on refresh, because the reaper
 * runs on a ~60s cycle and a just-expired token can still be present.
 */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken: Model<IRefreshToken> =
  mongoose.model<IRefreshToken>('RefreshToken', refreshTokenSchema);
