/**
 * Typed contracts for every routing key on the `football.events` exchange.
 *
 * These types are the integration surface between all five services: the publisher
 * and the consumer of each key both import from here, so a shape change that breaks
 * a consumer fails at compile time instead of silently at runtime.
 *
 * IMPORTANT: these describe what the code sends TODAY, including its inconsistencies.
 * See the `D-05` notes below — those divergences are preserved deliberately and are
 * tracked in the deferred backlog.
 */

export const EXCHANGE_NAME = 'football.events';
export const DLX_NAME = 'football.events.dlx';
export const DLQ_NAME = 'football.dlq';

/** Partial team info assembled by match-service's synchronous enrichment path. */
export interface TeamSummary {
  teamId: string;
  teamName?: string | undefined;
  email?: string | undefined;
  collegeName?: string | undefined;
}

/** Team info produced by identity-service's batch enrichment handler. */
export interface EnrichedTeam {
  teamId: string;
  role?: string;
  email?: string;
  collegeName?: string;
  teamName?: string;
  /** Set instead of the other fields when the lookup failed. */
  error?: string;
}

/**
 * A full Mongoose Team document after `.toObject()`.
 *
 * D-05: this includes `password` — the argon2 hash is published onto the bus by
 * identity-service's `handleTeamDetailEvent`. Preserved to keep the port
 * behavior-preserving; recorded as backlog item 12.
 */
export interface TeamDocumentPayload {
  _id: string;
  teamName: string;
  collegeName: string;
  email: string;
  password: string;
  logoUrl?: string;
  role: 'TEAM' | 'ADMIN';
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

/**
 * D-05: published by `createInvite`'s synchronous path WITHOUT a `purpose` field —
 * the `purpose: 'invite'` line is commented out at the call site. notification-service
 * switches on `event.purpose`, so this shape falls through to `default` and no email
 * is sent. The asynchronous fallback path adds `purpose: 'invite'` before publishing.
 * Both shapes are preserved; see backlog item 2.
 */
export interface InviteNotification {
  purpose?: 'invite';
  inviteId: string;
  matchId: string;
  sender: TeamSummary;
  receiver: TeamSummary;
  status: string;
  note: string | null;
  createdAt: string;
  /** Set at the publisher and never read by any consumer. Backlog item 8. */
  correlationId: string;
}

export interface MatchFixedNotification {
  purpose: 'match.fixed';
  matchId: string;
  inviteId: string;
  /** Undefined when enrichment produced no entry for the role. */
  acceptedTeam?: EnrichedTeam;
  hostTeam?: EnrichedTeam;
  rejectedTeams: EnrichedTeam[];
}

export type NotificationEvent = InviteNotification | MatchFixedNotification;

/**
 * The complete routing-key → payload map.
 *
 * D-05: the naming is inconsistent — PascalCase (`TeamDetails`), camelCase
 * (`teamDetailsForRespondingToInvite`) and dot.case (`profilePhoto.updated`) are all
 * in use. Renaming would require coordinated publisher and consumer changes across
 * service boundaries and would drop any message in flight during a deploy, so the
 * names are preserved. Backlog item 13.
 */
export interface EventMap {
  /** media-service → identity-service. Sets `Team.logoUrl`. */
  'profilePhoto.updated': { teamId: string; url: string };

  /** match-service → identity-service. Request for the full team document. */
  'fetchTeamDetails': { teamId: string; matchId: string };

  /** identity-service → match-service. Response to `fetchTeamDetails`. */
  'TeamDetails': TeamDocumentPayload & { matchId: string };

  /** match-service → identity-service. Async fallback when sync enrichment throws. */
  'fetchTeamDetailsForMatchInviteCreated': { receiverTeamId: string; matchId: string };

  /** identity-service → match-service. Projection of Team, plus matchId. */
  'TeamDetailsForMatchInvite': {
    _id: string;
    teamName: string;
    email: string;
    collegeName: string;
    matchId: string;
  };

  /** match-service → identity-service. Batch enrichment request. */
  'fetchTeamDetailsForRespondingToInvite': {
    matchId: string;
    inviteId: string;
    /** Always the literal string 'responding.to.invites' at the current call site. */
    purpose: string;
    teams: Array<{ teamId: string; role: string }>;
  };

  /** identity-service → match-service. Batch enrichment response. */
  'teamDetailsForRespondingToInvite': {
    matchId: string;
    inviteId: string;
    purpose: string;
    enrichedTeams: EnrichedTeam[];
  };

  /** match-service → notification-service. Triggers outbound email. */
  'notification': NotificationEvent;
}

export type RoutingKey = keyof EventMap;
