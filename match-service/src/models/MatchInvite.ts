import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * A challenge from one team to the host of a match.
 *
 * Both team ids are opaque Strings from identity-service; `matchId` is the only real
 * ref in this service, and `getIncomingInvites` / `getOutgoingInvites` populate it.
 *
 * D-MT-05: the invite controller also passes `note` and `idempotencyKey` to
 * `MatchInvite.create()`. Neither is a schema path, so Mongoose drops them silently
 * under strict mode — `idempotencyKey` provides no idempotency whatsoever, and the
 * `note` the controller reads back off the created document is always `undefined`.
 * They are deliberately NOT added here: adding them would start persisting fields the
 * service has never persisted. Architecture doc issue 7.
 */
export interface IMatchInvite extends Document {
  _id: mongoose.Types.ObjectId;
  senderTeamId: string;
  receiverTeamId: string;
  matchId: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  sentAt: Date;
  /** Declared by the schema but never written — nothing sets it on accept. Issue 14. */
  respondedAt?: Date;
}

const matchInviteSchema = new Schema<IMatchInvite>({
  senderTeamId: {
    type: String, // teamId from Identity Service
    required: true,
  },
  receiverTeamId: {
    type: String, // teamId from Identity Service (match creator)
    required: true,
  },
  matchId: {
    type: Schema.Types.ObjectId,
    ref: 'Match', // still valid, Match is in this service
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending',
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
  respondedAt: {
    type: Date,
  },
});

// Prevent duplicate invites (one sender -> one match). This is the only thing
// stopping a repeated `send-invite` call from creating a second pending invite —
// the `idempotencyKey` the controller passes does nothing (D-MT-05).
matchInviteSchema.index({ senderTeamId: 1, matchId: 1 }, { unique: true });

// `expired` exists in the status enum but nothing ever sets it: there is no TTL and
// no scheduler, so unanswered invites stay `pending` forever. Issue 17.

export const MatchInvite: Model<IMatchInvite> = mongoose.model<IMatchInvite>(
  'MatchInvite',
  matchInviteSchema,
);
