import type { Request, Response } from 'express';
import type { Logger } from '@uff/shared/logger';
import { Team } from '../models/Team.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { validateRegistration, validateLogin } from '../utils/validation.js';
import { generateToken } from '../utils/generateToken.js';

/**
 * Controllers are built by a factory so the logger is injected rather than imported
 * as a module singleton — `@uff/shared/logger` exports `createLogger(serviceName)`
 * rather than a pre-built instance, so the service name is bound once in server.ts.
 *
 * Called once, from `routes/identity-routes.ts`.
 */
export function createIdentityController(logger: Logger) {
  const registration = async (req: Request, res: Response): Promise<void> => {
    logger.info('Team registration started');
    try {
      const { error } = validateRegistration(req.body);
      if (error) {
        logger.warn('Validation error:', error.details[0]?.message);
        res.status(400).json({ message: error.details[0]?.message });
        return;
      }

      const { email, password, teamName, collegeName } = req.body as {
        email: string;
        password: string;
        teamName: string;
        collegeName: string;
      };

      // Duplicate check spans BOTH email and teamName, so two colleges cannot
      // register the same team name even with different addresses.
      const existing = await Team.findOne({ $or: [{ email }, { teamName }] });
      if (existing) {
        logger.warn('Team Already Exist');
        res.status(400).json({ message: 'Team Already Exist' });
        return;
      }

      // The pre-save hook on Team hashes the password with argon2.
      const team = new Team({ email, password, collegeName, teamName });
      await team.save();
      logger.info('Team Saved Successfully', team._id);

      const { accesstoken, refreshtoken } = await generateToken(team);
      res.status(201).json({
        message: 'Team Registered Successfully',
        accesstoken,
        refreshtoken,
      });
    } catch (err) {
      logger.error('Error during registration:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const loginUser = async (req: Request, res: Response): Promise<void> => {
    logger.info('Team Login started');
    try {
      const { error } = validateLogin(req.body);
      if (error) {
        logger.warn('Validation error:', error.details[0]?.message);
        res.status(400).json({ message: error.details[0]?.message });
        return;
      }

      const { email, password } = req.body as { email: string; password: string };
      const team = await Team.findOne({ email });
      if (!team) {
        logger.warn('Team Not Found');
        res.status(404).json({ message: 'Team Not Found' });
        return;
      }

      const isValidPassword = await team.comparePassword(password);
      if (!isValidPassword) {
        logger.warn('Password is not valid');
        // Preserved: the original returns 404, not 401, for a bad password.
        res.status(404).json({ message: 'Invalid Password' });
        return;
      }

      const { accesstoken, refreshtoken } = await generateToken(team);
      res.json({
        accesstoken,
        refreshtoken,
        team: team._id,
        message: 'Team Logged In Successfully',
      });
    } catch (err) {
      logger.error('Error during login:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const refreshTokenUser = async (req: Request, res: Response): Promise<void> => {
    logger.info('Refresh Token started');
    try {
      const { refreshtoken } = req.body as { refreshtoken?: string };
      if (!refreshtoken) {
        logger.warn('Refresh token is missing');
        res.status(400).json({ message: 'Refresh token is missing' });
        return;
      }

      // The explicit expiry check matters despite the TTL index: Mongo's reaper runs
      // on roughly a 60s cycle, so a just-expired token can still be present.
      const storedToken = await RefreshToken.findOne({ token: refreshtoken });
      if (!storedToken || storedToken.expiresAt < new Date()) {
        logger.warn('Invalid or expired refresh token');
        res.status(400).json({ message: 'Invalid or expired refresh token' });
        return;
      }

      const team = await Team.findById(storedToken.team);
      if (!team) {
        logger.warn('Team not found for the refresh token');
        res.status(404).json({ message: 'Team not found' });
        return;
      }

      const { accesstoken: newAccesstoken, refreshtoken: newRefreshToken } =
        await generateToken(team);

      // Rotation: the presented token is destroyed once its replacement exists.
      await RefreshToken.deleteOne({ _id: storedToken._id });

      res.json({
        accesstoken: newAccesstoken,
        refreshtoken: newRefreshToken,
        message: 'Tokens refreshed successfully',
      });
    } catch (err) {
      logger.error('Error during refresh token:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const logoutUser = async (req: Request, res: Response): Promise<void> => {
    logger.info('Team logout Endpoint hit');
    try {
      const { refreshtoken } = req.body as { refreshtoken?: string };
      if (!refreshtoken) {
        logger.warn('Refresh token is missing');
        res.status(400).json({ message: 'Refresh token is missing' });
        return;
      }
      await RefreshToken.deleteOne({ token: refreshtoken });
      logger.info('Team logged out successfully');
      res.status(200).json({ message: 'Team logged out successfully' });
    } catch (err) {
      logger.error('Error during logout:', err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  /**
   * Read model consumed by match-service's synchronous enrichment path
   * (axios GET /v1/auth/getTeamById/:teamId through the gateway, 700ms timeout).
   * This is the only route another service calls, and it sits on the hot path of
   * the invite flow.
   *
   * A-1: `.select('-password')` is the important part of this line.
   *
   * The gateway does not require a JWT on `/v1/auth` — that is where tokens are
   * issued, so demanding one would make login unreachable — which means this route is
   * PUBLIC. It previously returned the whole Team document, so the argon2 hash was
   * readable by anyone who knew a team id, over the internet, with no credentials.
   * `INTERNAL_SECRET` does not help here: the request arrives legitimately through
   * the gateway.
   *
   * Projecting the field away is the fix. Nothing that calls this route has ever read
   * `password` — match-service uses `teamName`, `email` and `collegeName` for
   * enrichment.
   */
  const getTeamById = async (req: Request, res: Response): Promise<void> => {
    const { teamId } = req.params;
    logger.info(`Fetching team with ID ${teamId}`);
    try {
      const team = await Team.findById(teamId).select('-password');
      if (!team) {
        logger.warn(`Team with ID ${teamId} not found`);
        res.status(404).json({ message: 'Team not found' });
        return;
      }
      res.status(200).json(team);
    } catch (error) {
      // Fixes a latent crash: the original logged `${id}`, an undefined variable,
      // which threw a ReferenceError inside the catch block and masked the real error.
      logger.error(`Error fetching team with ID ${teamId}:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  };

  return { registration, loginUser, refreshTokenUser, logoutUser, getTeamById };
}
