/**
 * The three outbound HTML bodies. Pure functions — no logger, no factory.
 *
 * Called only from `services/notificationService.ts`.
 *
 * The interpolation is UNESCAPED, exactly as in the original: `teamName` and
 * `collegeName` are team-supplied strings that reach an email body verbatim, which
 * is an HTML-injection vector into outbound mail. Preserved, not fixed — backlog
 * item 11 / D-NT-08.
 */

/**
 * The only fields any template reads.
 *
 * Declared structurally rather than as `TeamSummary` or `EnrichedTeam` because both
 * of those reach these functions: the `match.fixed` path passes `EnrichedTeam`, and
 * the invite path passes what it believes is a `TeamSummary`. Both have every field
 * optional, so a missing one interpolates as the literal string `undefined` — which
 * is the original behaviour and the reason these emails can go out half-blank.
 */
export interface TemplateTeam {
  teamName?: string | undefined;
  collegeName?: string | undefined;
}

/** Sent to the host when someone requests to play their hosted match. */
export function inviteTemplate(hostTeam: TemplateTeam, acceptedTeam: TemplateTeam): string {
  return `
    <h2>📢 New Match Invite</h2>
    <p>Hello <b>${hostTeam.teamName}</b>,</p>
    <p>You have received a match request for the match you are hosting.</p>
    <p><b>${acceptedTeam.teamName}</b> (${acceptedTeam.collegeName}) is interested in playing against you.</p>
    <p>Please review the invite in your dashboard.</p>
    <br/>
    <p>⚽ Stay sharp,</p>
    <p><i>Uni_Football_Fixer</i></p>
  `;
}

/**
 * Sent twice per fixed match, with the arguments swapped — once to the host with the
 * accepted team as `opponent`, once to the accepted team with the host as `opponent`.
 *
 * Carries no match time or location even though `matchId` is on the payload.
 */
export function matchFixedTemplate(team: TemplateTeam, opponent: TemplateTeam): string {
  return `
    <h2>✅ Match Confirmed!</h2>
    <p>Hello <b>${team.teamName}</b>,</p>
    <p>Great news! Your match has been fixed.</p>
    <p>You will be playing against <b>${opponent.teamName}</b> (${opponent.collegeName}).</p>
    <p>Get ready and best of luck!</p>
    <br/>
    <p>⚽ See you on the field,</p>
    <p><i>Uni_Football_Fixer</i></p>
  `;
}

/** Sent to every team whose invite lost once the host accepted a different one. */
export function rejectTemplate(team: TemplateTeam, hostTeam: TemplateTeam): string {
  return `
    <h2>❌ Match Invite Rejected</h2>
    <p>Hello <b>${team.teamName}</b>,</p>
    <p>Unfortunately, your match invite to <b>${hostTeam.teamName}</b> (${hostTeam.collegeName}) was not accepted.</p>
    <p>Don’t worry—more opportunities are waiting. Keep exploring other matches!</p>
    <br/>
    <p>⚽ Stay motivated,</p>
    <p><i>Uni_Football_Fixer</i></p>
  `;
}
