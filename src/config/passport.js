const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const Team = require('../models/team.model');

const options = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET,
};

exports.initializePassport = (passport) => {
  passport.use(
    new JwtStrategy(options, async (jwt_payload, done) => {
      try {
        const team = await Team.findById(jwt_payload.teamId);
        if (team) {
          return done(null, team);
        }
        return done(null, false);
      } catch (error) {
        return done(error, false);
      }
    })
  );
};
