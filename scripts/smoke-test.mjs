/**
 * End-to-end smoke test against the docker-compose stack.
 *
 * Everything goes through the gateway on :3000 — never a service port directly —
 * so this also proves the /v1 -> /api path rewriting and the JWT verification work.
 *
 * The assertions that matter are the ones marked CROSSES RABBITMQ. They are the only
 * checks in the whole migration that can detect a broken event handler: `tsc` cannot
 * reach across the bus, and the HTTP responses don't reflect it either, because the
 * denormalised fields are written by consumers AFTER the response returns.
 *
 * Those assertions poll rather than sleep — a fixed sleep is either flaky or slow.
 */

const GW = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const stamp = Date.now();

let failures = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

async function poll(name, fn, { attempts = 30, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await fn()) {
        check(name, true);
        return true;
      }
    } catch {
      /* consumer may not have run yet — keep polling */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  check(name, false, `(gave up after ${attempts} attempts / ${(attempts * delayMs) / 1000}s)`);
  return false;
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
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const asArray = (j) => (Array.isArray(j) ? j : (j?.matches ?? []));

console.log('\n--- 1. Gateway is up ---');
const health = await api('/health');
check('gateway /health responds 200', health.status === 200, `got ${health.status}`);

console.log('\n--- 2. Register + login host team ---');
const host = {
  teamName: `HostTeam${stamp}`,
  collegeName: 'Host College',
  email: `host${stamp}@example.com`,
  password: 'password123',
};
const hostReg = await api('/v1/auth/register', { method: 'POST', body: host });
check('host registered (201)', hostReg.status === 201, `got ${hostReg.status} ${JSON.stringify(hostReg.json).slice(0, 200)}`);

const hostLogin = await api('/v1/auth/login', {
  method: 'POST',
  body: { email: host.email, password: host.password },
});
check('host logged in (200)', hostLogin.status === 200, `got ${hostLogin.status}`);
const hostToken = hostLogin.json.accesstoken;
const hostTeamId = hostLogin.json.team;
check('access token issued', typeof hostToken === 'string' && hostToken.length > 0);
check('team id returned', Boolean(hostTeamId));

console.log('\n--- 3. Register + login challenger team ---');
const guest = {
  teamName: `GuestTeam${stamp}`,
  collegeName: 'Guest College',
  email: `guest${stamp}@example.com`,
  password: 'password123',
};
const guestReg = await api('/v1/auth/register', { method: 'POST', body: guest });
check('guest registered (201)', guestReg.status === 201, `got ${guestReg.status}`);
const guestLogin = await api('/v1/auth/login', {
  method: 'POST',
  body: { email: guest.email, password: guest.password },
});
check('guest logged in (200)', guestLogin.status === 200, `got ${guestLogin.status}`);
const guestToken = guestLogin.json.accesstoken;

console.log('\n--- 4. Auth is actually enforced at the gateway ---');
const noAuth = await api('/v1/match/create-match', {
  method: 'POST',
  body: { matchTime: new Date().toISOString(), location: 'Ground A' },
});
check('unauthenticated match creation rejected (401)', noAuth.status === 401, `got ${noAuth.status}`);

const badToken = await api('/v1/match/create-match', {
  method: 'POST',
  token: 'not-a-real-jwt',
  body: { matchTime: new Date().toISOString(), location: 'Ground A' },
});
check('invalid token rejected (403)', badToken.status === 403, `got ${badToken.status}`);

console.log('\n--- 5. Create a match ---');
const created = await api('/v1/match/create-match', {
  method: 'POST',
  token: hostToken,
  body: {
    matchTime: new Date(Date.now() + 86_400_000).toISOString(),
    location: 'Ground A',
  },
});
check('match created (201)', created.status === 201, `got ${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
const matchId = created.json?._id;
check('match id returned', Boolean(matchId));
check("new match status is 'open'", created.json?.status === 'open', `got ${created.json?.status}`);

console.log('\n--- 6. CROSSES RABBITMQ: match gets denormalised team details ---');
// match-service publishes `fetchTeamDetails`; identity-service consumes it and answers
// with `TeamDetails`; match-service consumes that and writes teamName/collegeName onto
// the Match. None of it is visible in the create response, which returns first.
await poll('teamName populated via fetchTeamDetails -> TeamDetails round-trip', async () => {
  const res = await api('/v1/match/get-my-matches/', { token: hostToken });
  const m = asArray(res.json).find((x) => String(x._id) === String(matchId));
  return Boolean(m?.teamName);
});

console.log('\n--- 7. Send an invite ---');
const invite = await api(`/v1/match/send-invite/${matchId}`, {
  method: 'POST',
  token: guestToken,
  body: {},
});
check('invite created (201)', invite.status === 201, `got ${invite.status} ${JSON.stringify(invite.json).slice(0, 200)}`);
const inviteId = invite.json?._id;
check('invite id returned', Boolean(inviteId));

console.log('\n--- 8. Host accepts the invite ---');
const accepted = await api(`/v1/match/respond-to-invites/${inviteId}`, {
  method: 'POST',
  token: hostToken,
  body: { response: 'accepted' },
});
check('invite accepted (200)', accepted.status === 200, `got ${accepted.status} ${JSON.stringify(accepted.json).slice(0, 200)}`);

console.log('\n--- 9. CROSSES RABBITMQ: match reaches "matched" ---');
await poll('match status becomes matched', async () => {
  const res = await api('/v1/match/get-my-matches/', { token: hostToken });
  const m = asArray(res.json).find((x) => String(x._id) === String(matchId));
  return m?.status === 'matched';
});

console.log('\n--- 10. Token refresh + logout ---');
const refreshed = await api('/v1/auth/refresh-token', {
  method: 'POST',
  body: { refreshtoken: hostLogin.json.refreshtoken },
});
check('tokens refreshed (200)', refreshed.status === 200, `got ${refreshed.status}`);

const loggedOut = await api('/v1/auth/logout', {
  method: 'POST',
  body: { refreshtoken: refreshed.json.refreshtoken },
});
check('logout (200)', loggedOut.status === 200, `got ${loggedOut.status}`);

// NOT covered: media upload. It requires real Cloudinary credentials, so the
// profilePhoto.updated event path is not exercised here. Run it manually with
// CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET set if you need it.

const passed = results.filter((r) => r.ok).length;
console.log(`\n${'='.repeat(60)}`);
console.log(`${passed}/${results.length} checks passed`);
console.log(failures === 0 ? 'SMOKE TEST PASSED' : `SMOKE TEST FAILED (${failures} failures)`);
console.log('='.repeat(60));

if (failures > 0) {
  console.log(`
If steps 6 or 9 failed while everything else passed, the break is in the event
pipeline, not the HTTP layer. Check, in this order:

  docker compose exec rabbitmq rabbitmqctl list_queues name durable messages
      -> any 'amq.gen-*' name means a consumeEvent call site lost its queue-name arg
  docker compose exec rabbitmq rabbitmqctl list_queues | grep football.dlq
      -> a non-zero count means a handler threw and the message was dead-lettered
  docker compose logs identity-service match-service --tail=50
`);
}

process.exit(failures === 0 ? 0 : 1);
