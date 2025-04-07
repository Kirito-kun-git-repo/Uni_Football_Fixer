const nodemailer = require('nodemailer');

console.log('Email configuration:', {
  user: process.env.EMAIL_USER,
  hasPassword: !!process.env.EMAIL_APP_PASSWORD
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

// Verify transporter configuration
transporter.verify(function(error, success) {
  if (error) {
    console.error('Email transporter verification failed:', error);
  } else {
    console.log('Email transporter is ready to send emails');
  }
});

const sendEmail = async (to, subject, text, html) => {
  try {
    console.log('Attempting to send email:', {
      from: process.env.EMAIL_USER,
      to,
      subject
    });

    const mailOptions = {
      from: `"Football Fixer" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

const sendMatchInviteEmail = async (to, matchDetails, senderTeam) => {
  console.log('Preparing match invite email:', {
    to,
    matchDetails,
    senderTeam
  });

  const subject = 'New Match Invite - Football Fixer';
  const text = `You have received a new match invite from ${senderTeam.teamName} (${senderTeam.collegeName}).\n\nMatch Details:\nTime: ${matchDetails.matchTime}\nLocation: ${matchDetails.location}\n\nPlease log in to your account to respond to this invite.`;
  
  const html = `
    <h2>New Match Invite</h2>
    <p>You have received a new match invite from <strong>${senderTeam.teamName}</strong> (${senderTeam.collegeName}).</p>
    <h3>Match Details:</h3>
    <ul>
      <li>Time: ${matchDetails.matchTime}</li>
      <li>Location: ${matchDetails.location}</li>
    </ul>
    <p>Please log in to your account to respond to this invite.</p>
  `;

  return sendEmail(to, subject, text, html);
};

const sendMatchAcceptanceEmail = async (to, matchDetails, acceptingTeam) => {
  console.log('Preparing match acceptance email:', {
    to,
    matchDetails,
    acceptingTeam
  });

  const subject = 'Match Invite Accepted - Football Fixer';
  const text = `Your match invite has been accepted by ${acceptingTeam.teamName} (${acceptingTeam.collegeName}).\n\nMatch Details:\nTime: ${matchDetails.matchTime}\nLocation: ${matchDetails.location}\n\nPlease log in to your account to view the match details.`;
  
  const html = `
    <h2>Match Invite Accepted</h2>
    <p>Your match invite has been accepted by <strong>${acceptingTeam.teamName}</strong> (${acceptingTeam.collegeName}).</p>
    <h3>Match Details:</h3>
    <ul>
      <li>Time: ${matchDetails.matchTime}</li>
      <li>Location: ${matchDetails.location}</li>
    </ul>
    <p>Please log in to your account to view the match details.</p>
  `;

  return sendEmail(to, subject, text, html);
};

module.exports = {
  sendEmail,
  sendMatchInviteEmail,
  sendMatchAcceptanceEmail
}; 