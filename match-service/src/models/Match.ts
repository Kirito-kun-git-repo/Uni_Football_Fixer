import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * A match hosted by one team, open for challenges until an invite is accepted.
 *
 * `teamId` is a plain String, not an ObjectId ref — the team lives in
 * identity-service, so there is nothing in this database to populate against.
 * `teamName` and `collegeName` are a denormalised cache of that team, written
 * asynchronously by `handleTeamDetailEvent` after the `fetchTeamDetails` /
 * `TeamDetails` round-trip completes. They are therefore undefined on the response
 * `createMatch` returns, and populated some milliseconds later.
 */
export interface IMatch extends Document {
  _id: mongoose.Types.ObjectId;
  teamId: string;
  teamName?: string;
  collegeName?: string;
  matchTime: Date;
  location: string;
  status: 'open' | 'matched' | 'cancelled' | 'completed';
  createdAt: Date;
}

const matchSchema = new Schema<IMatch>({
  // Instead of ObjectId ref, we store the Team's UUID/ID from Identity Service
  teamId: {
    type: String,
    required: true,
  },

  // Cached team info from Identity Service
  teamName: {
    type: String,
  },
  collegeName: {
    type: String,
  },

  matchTime: {
    type: Date,
    required: true,
  },

  location: {
    type: String,
    required: true,
  },

  status: {
    type: String,
    enum: ['open', 'matched', 'cancelled', 'completed'],
    default: 'open',
  },

  // Not `timestamps: true` — this schema has createdAt only, and no updatedAt.
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// D-MT-08: no index on `teamId` or `status` despite both being the hottest query
// fields (`getMyMatches`, and every future status filter). Preserved as-is —
// adding one changes query plans, which is a performance change, not a port.
// Architecture doc issue 13.

export const Match: Model<IMatch> = mongoose.model<IMatch>('Match', matchSchema);
