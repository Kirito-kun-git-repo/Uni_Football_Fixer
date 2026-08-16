import mongoose, { Schema, type Document, type Model } from 'mongoose';
import argon2 from 'argon2';

export interface ITeam extends Document {
  _id: mongoose.Types.ObjectId;
  teamName: string;
  collegeName: string;
  email: string;
  password: string;
  logoUrl?: string;
  role: 'TEAM' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
  comparePassword(password: string): Promise<boolean>;
}

const teamSchema = new Schema<ITeam>(
  {
    teamName: { type: String, required: true, trim: true },
    collegeName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, trim: true },
    logoUrl: { type: String },
    role: { type: String, enum: ['TEAM', 'ADMIN'], default: 'TEAM' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

/**
 * Hashes on save. Runs on registration and on any later password change; the
 * `isModified` guard is what stops a re-save of an unrelated field (e.g. the
 * logoUrl write in handleProfileUploadEvent) from double-hashing an already-hashed
 * password.
 *
 * D-MT/D-10 note: Mongoose 9 removed the `next` callback from pre-save hooks —
 * `PreSaveMiddlewareFunction` is now `(this, opts: SaveOptions) => void | Promise<void>`.
 * Resolving continues the save; throwing aborts it, which is exactly what the old
 * `next(err)` did. Behaviour is unchanged; only the signalling mechanism moved.
 */
teamSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await argon2.hash(this.password);
  }
});

/** Used only by the login controller. Throws rather than returning false on an argon2 fault. */
teamSchema.methods['comparePassword'] = async function (
  this: ITeam,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(this.password, password);
  } catch {
    throw new Error('Password comparison failed');
  }
};

teamSchema.index({ teamName: 'text' });

export const Team: Model<ITeam> = mongoose.model<ITeam>('Team', teamSchema);
