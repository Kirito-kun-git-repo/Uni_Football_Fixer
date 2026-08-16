import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * The delivery-audit record. Ported field-for-field from the original schema,
 * including the parts nothing writes.
 *
 * NOTE — this collection is empty in production and stays empty after the port.
 * `utils/mailer.ts` builds a create() payload that does not match this schema:
 * it omits `recipientTeamId` and `type` (both required) and adds `metadata` and a
 * top-level `status` (neither is a schema path). Every `Notification.create()`
 * therefore rejects with a Mongoose `ValidationError`. That is reproduced
 * deliberately — see D-NT-06 and FLOW.md. Do not "fix" this model to match the
 * writer; the writer is the side that is wrong, and correcting either one changes
 * observable behaviour.
 */
export type NotificationType =
  | 'invite.sent'
  | 'invite.accepted'
  | 'invite.rejected'
  | 'match.fixed'
  | 'match.updated'
  | 'match.cancelled';

export interface INotification extends Document {
  recipientTeamId: string;
  recipientEmail?: string;
  matchId?: string;
  inviteId?: string;
  type: NotificationType;
  message: string;
  delivery: {
    channel: 'email' | 'in-app';
    status: 'pending' | 'sent' | 'failed';
    error?: string;
  };
  /** For an in-app inbox that has no read endpoint anywhere in the system. */
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    // Team._id, stored as a string because that is how it travels on the event bus.
    recipientTeamId: { type: String, required: true },
    recipientEmail: { type: String },
    matchId: { type: String, required: false },
    inviteId: { type: String, required: false },
    type: {
      type: String,
      enum: [
        'invite.sent',
        'invite.accepted',
        'invite.rejected',
        'match.fixed',
        'match.updated',
        'match.cancelled',
      ],
      required: true,
    },
    message: { type: String, required: true },
    delivery: {
      channel: { type: String, enum: ['email', 'in-app'], default: 'email' },
      status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
      error: { type: String },
    },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Supports the "notifications for this team, newest first" query the unbuilt in-app
// inbox would make. Nothing reads it today.
notificationSchema.index({ recipientTeamId: 1, createdAt: -1 });

export const Notification: Model<INotification> = mongoose.model<INotification>(
  'Notification',
  notificationSchema,
);
