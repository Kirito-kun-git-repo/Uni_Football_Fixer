// utils/templates.js

// Invite mail template
function inviteTemplate(hostTeam, acceptedTeam) {
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

// Match fixed mail template
function matchFixedTemplate(team, opponent) {
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

// Rejection mail template
function rejectTemplate(team, hostTeam) {
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

module.exports = {
  inviteTemplate,
  matchFixedTemplate,
  rejectTemplate
};
