/**
 * LIVE end-to-end test against real Cloudinary and real Gmail.
 *
 * Unlike scripts/smoke-test.mjs, this one has REAL side effects: it uploads an asset
 * to your Cloudinary account and sends five emails to three real inboxes. It is meant
 * to be run by hand, not in CI.
 *
 * It exercises two paths nothing has ever exercised:
 *   - the Cloudinary upload chain, including the profilePhoto.updated event that
 *     writes logoUrl back onto the Team in identity-service (backlog A-11)
 *   - the REJECTION email, which needs three teams; the smoke test has only two, so
 *     rejectedTeams has always been empty
 *
 * Setup — put these in .env, then recreate the two services that read them:
 *   EMAIL_USER, EMAIL_APP_PASSWORD     (Gmail app password; account needs 2FA)
 *   CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *   SMTP_HOST=                         (MUST be blank, or mail goes to Mailpit)
 *   TEST_EMAIL_1, TEST_EMAIL_2, TEST_EMAIL_3
 *
 *   docker compose up -d --force-recreate notification-service media-service
 *   node scripts/live-test.mjs
 */

const GW = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const stamp = Date.now();

const HOST_EMAIL = process.env.TEST_EMAIL_1;
const ACCEPTED_EMAIL = process.env.TEST_EMAIL_2;
const REJECTED_EMAIL = process.env.TEST_EMAIL_3;

if (!HOST_EMAIL || !ACCEPTED_EMAIL || !REJECTED_EMAIL) {
  console.error('Set TEST_EMAIL_1, TEST_EMAIL_2 and TEST_EMAIL_3 in .env first.');
  process.exit(1);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
};

async function poll(name, fn, { attempts = 40, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await fn()) return check(name, true), true;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return check(name, false, `(gave up after ${(attempts * delayMs) / 1000}s)`), false;
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${GW}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; }
  catch { return { status: res.status, json: { raw: text } }; }
}

async function register(teamName, collegeName, email) {
  const password = 'password123';
  const reg = await api('/v1/auth/register', {
    method: 'POST',
    body: { teamName, collegeName, email, password },
  });
  check(`registered ${teamName} (${email})`, reg.status === 201,
    `got ${reg.status} ${JSON.stringify(reg.json).slice(0, 160)}`);
  const login = await api('/v1/auth/login', { method: 'POST', body: { email, password } });
  check(`logged in ${teamName}`, login.status === 200, `got ${login.status}`);
  return { teamName, collegeName, email, token: login.json.accesstoken, teamId: login.json.team };
}

/** Smallest valid PNG — a single opaque pixel. Avoids shipping a binary fixture. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

console.log(`
================================================================
 LIVE TEST — real Cloudinary uploads, real emails to real inboxes
================================================================
  host / rejects one   ${HOST_EMAIL}
  gets ACCEPTED        ${ACCEPTED_EMAIL}
  gets REJECTED        ${REJECTED_EMAIL}
`);

console.log('--- 1. Register three teams ---');
const host = await register(`HostFC${stamp}`, 'Host College', HOST_EMAIL);
const teamB = await register(`ChallengerB${stamp}`, 'Bravo College', ACCEPTED_EMAIL);
const teamC = await register(`ChallengerC${stamp}`, 'Charlie College', REJECTED_EMAIL);

console.log('\n--- 2. REAL CLOUDINARY: host uploads a team logo ---');
const form = new FormData();
form.append('file', new Blob([ONE_PIXEL_PNG], { type: 'image/png' }), 'logo.png');
const upload = await fetch(`${GW}/v1/media/upload-logo`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${host.token}` },
  body: form,
});
const uploadBody = await upload.json().catch(() => ({}));
check('logo uploaded to Cloudinary (201)', upload.status === 201,
  `got ${upload.status} ${JSON.stringify(uploadBody).slice(0, 200)}`);
check('Cloudinary returned a URL', typeof uploadBody.url === 'string' || Boolean(uploadBody.mediaId),
  JSON.stringify(uploadBody).slice(0, 200));

console.log('\n--- 3. CROSSES RABBITMQ: profilePhoto.updated writes logoUrl onto the Team ---');
// media-service publishes profilePhoto.updated; identity-service consumes it and sets
// Team.logoUrl. Never exercised before today (backlog A-11).
await poll('Team.logoUrl populated by profilePhoto.updated', async () => {
  const res = await api(`/v1/auth/getTeamById/${host.teamId}`);
  return typeof res.json?.logoUrl === 'string' && res.json.logoUrl.length > 0;
});

console.log('\n--- 4. Host publishes a match ---');
const created = await api('/v1/match/create-match', {
  method: 'POST',
  token: host.token,
  body: { matchTime: new Date(Date.now() + 7 * 86_400_000).toISOString(), location: 'Main Ground' },
});
check('match created (201)', created.status === 201, `got ${created.status}`);
const matchId = created.json?._id;
check('match id returned', Boolean(matchId));

await poll('match enriched with host team name', async () => {
  const res = await api('/v1/match/get-my-matches/', { token: host.token });
  const list = Array.isArray(res.json) ? res.json : (res.json.matches ?? []);
  return Boolean(list.find((m) => String(m._id) === String(matchId))?.teamName);
});

console.log('\n--- 5. Both challengers apply → 2 invite emails to the host ---');
const inviteB = await api(`/v1/match/send-invite/${matchId}`, { method: 'POST', token: teamB.token, body: {} });
check(`${teamB.teamName} applied (201)`, inviteB.status === 201, `got ${inviteB.status}`);
const inviteBId = inviteB.json?._id;

const inviteC = await api(`/v1/match/send-invite/${matchId}`, { method: 'POST', token: teamC.token, body: {} });
check(`${teamC.teamName} applied (201)`, inviteC.status === 201, `got ${inviteC.status}`);

console.log('\n--- 6. Host ACCEPTS the first challenger ---');
const accepted = await api(`/v1/match/respond-to-invites/${inviteBId}`, {
  method: 'POST',
  token: host.token,
  body: { response: 'accepted' },
});
check('invite accepted (200)', accepted.status === 200,
  `got ${accepted.status} ${JSON.stringify(accepted.json).slice(0, 160)}`);

console.log('\n--- 7. CROSSES RABBITMQ: match fixed, other invite auto-rejected ---');
await poll('match status is matched', async () => {
  const res = await api('/v1/match/get-my-matches/', { token: host.token });
  const list = Array.isArray(res.json) ? res.json : (res.json.matches ?? []);
  return list.find((m) => String(m._id) === String(matchId))?.status === 'matched';
});

await poll(`${teamC.teamName}'s invite auto-rejected`, async () => {
  const res = await api('/v1/match/get-outgoing-invites/', { token: teamC.token });
  const list = Array.isArray(res.json) ? res.json : (res.json.invites ?? []);
  // getOutgoingInvites does `.populate('matchId')`, so `matchId` is the whole Match
  // document, not an id. Comparing it directly stringifies to "[object Object]" and
  // never matches — that cost a false failure on the first live run.
  const idOf = (m) => String(m?._id ?? m);
  return list.some((i) => idOf(i.matchId) === String(matchId) && i.status === 'rejected');
});

console.log(`
================================================================
 ${failures === 0 ? 'ALL AUTOMATED CHECKS PASSED' : `${failures} AUTOMATED CHECK(S) FAILED`}

 NOW CHECK THE THREE INBOXES. Expected, 5 emails total:

   ${HOST_EMAIL}
     x2  "New Match Invite!"      (one per challenger)
     x1  "Match Fixed!"
   ${ACCEPTED_EMAIL}
     x1  "Match Fixed!"
   ${REJECTED_EMAIL}
     x1  "Match Invite Rejected"   <-- never sent before today

 Check spam folders: these are HTML mails sent from your own Gmail
 to addresses you control, which Gmail sometimes files as spam.
================================================================
`);

process.exit(failures === 0 ? 0 : 1);
