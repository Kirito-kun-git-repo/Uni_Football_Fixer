const mongoose = require('mongoose');
const argon2 = require('argon2');

const teamSchema = new mongoose.Schema(
  {
    teamName: {
      type: String,
      required: true,
      trim: true, //team name
    },
    collegeName: {
      type: String,
      required: true,
      trim: true, // college name
    },


    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      trim: true,
    },
    logoUrl: {
      type: String, // optional: profile picture / logo
    },
    role: {
      type: String,
      enum: ["TEAM", "ADMIN"],
      default: "TEAM", // only teams can self-register, admins are seeded manually
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

// Hash password before save
teamSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    try {
      this.password = await argon2.hash(this.password);
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Compare password method
teamSchema.methods.comparePassword = async function (password) {
  try {
    return await argon2.verify(this.password, password);
  } catch (err) {
    throw new Error("Password comparison failed");
  }
};

// Index for team search (by name)
teamSchema.index({ teamName: "text" });

const Team = mongoose.model("Team", teamSchema);
module.exports = Team;
