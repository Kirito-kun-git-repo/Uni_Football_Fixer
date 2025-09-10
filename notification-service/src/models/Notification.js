const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // Who is this notification for?
    recipientTeamId: {
      type: String, // from Team._id (string, since you’re storing as string in events)
      required: true,
    },

    recipientEmail: {
      type: String, // cached for quick lookup, not strictly required
    },

    // What is the context?
    matchId: {
      type: String, // Match._id
      required: false, // not all notifications need a match
    },

    inviteId: {
      type: String, // Invite._id
      required: false,
    },

    // What kind of notification
    type: {
      type: String,
      enum: [
        "invite.sent",
        "invite.accepted",
        "invite.rejected",
        "match.fixed",
        "match.updated",
        "match.cancelled",
      ],
      required: true,
    },

    // Human-readable message
    message: {
      type: String,
      required: true,
    },

    // Delivery tracking
    delivery: {
      channel: {
        type: String,
        enum: ["email", "in-app"], // future-proofing
        default: "email",
      },
      status: {
        type: String,
        enum: ["pending", "sent", "failed"],
        default: "pending",
      },
      error: {
        type: String, // error logs if failed
      },
    },

    read: {
      type: Boolean, // for in-app notifications
      default: false,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for querying notifications by team
notificationSchema.index({ recipientTeamId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
