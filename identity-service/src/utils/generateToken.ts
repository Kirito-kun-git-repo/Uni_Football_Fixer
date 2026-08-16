import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import type { ITeam } from '../models/Team.js';

export interface TokenPair {
  accesstoken: string;
  refreshtoken: string;
}

/**
 * Issues the access/refresh pair. Called by registration, login, and refresh —
 * three of the five routes on this service.
 *
 * The refresh token is opaque (64 random bytes, hex) and is persisted; the TTL index
 * on RefreshToken.expiresAt reaps it after 7 days. Rotation happens at the call site
 * in `refreshTokenUser`, which deletes the presented token after issuing a new pair.
 *
 * NOTE: `name: team.name` is signed here, but the Team model's field is `teamName`,
 * so this claim is always undefined — and it propagates to every downstream service
 * via the gateway's decoded `req.team`. Preserved as-is; backlog item 5.
 */
export async function generateToken(team: ITeam): Promise<TokenPair> {
  const accesstoken = jwt.sign(
    {
      teamId: team._id,
      name: (team as unknown as { name?: string }).name,
    },
    env.JWT_SECRET,
    { expiresIn: '15m' },
  );

  const refreshtoken = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await RefreshToken.create({
    token: refreshtoken,
    team: team._id,
    expiresAt,
  });

  return { accesstoken, refreshtoken };
}
