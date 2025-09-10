const logger = require("../utils/logger");
const mailer = require("../utils/mailer");
const templates = require("../utils/templates");

async function handleInvite(event) {
    try{
        const { hostTeam, acceptedTeam } = event;
        logger.info("Sending invite email to host and accepted team ",hostTeam,acceptedTeam);

        const subject = "New Match Invite!";
        const body = templates.inviteTemplate(hostTeam, acceptedTeam);

        await mailer.sendMail({
            to: hostTeam.email,
            subject,
            html: body
        });

    }
    catch(err){
        logger.error('Error in sending mail for invite',err);
    }
  
}

async function handleMatchFixed(event) {

    try{
        logger.info("Sending fixed match emails");

        const { hostTeam, acceptedTeam, rejectedTeams } = event;

        // host + accepted get positive mail
        await mailer.sendMail({
            to: hostTeam.email,
            subject: "Match Fixed!",
            html: templates.matchFixedTemplate(hostTeam, acceptedTeam)
        });

        await mailer.sendMail({
            to: acceptedTeam.email,
            subject: "Match Fixed!",
            html: templates.matchFixedTemplate(acceptedTeam, hostTeam)
        });

        // rejected get rejection mail
        for (let team of rejectedTeams) {
            await mailer.sendMail({
            to: team.email,
            subject: "Match Invite Rejected",
            html: templates.rejectTemplate(team, hostTeam)
            });
        }

    }
    catch(err){
        logger.error('Error in sending mail for fixed match',err);
    }
  
}

module.exports = { handleInvite, handleMatchFixed };
