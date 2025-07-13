import React from 'react';

const cardStyle = {
  border: '1px solid #2d6cdf',
  borderRadius: '12px',
  padding: '20px',
  margin: '20px auto',
  maxWidth: '400px',
  background: 'linear-gradient(135deg, #e3f0ff 0%, #f9f9f9 100%)',
  boxShadow: '0 4px 16px rgba(45,108,223,0.12)',
  transition: 'box-shadow 0.2s',
};

const labelStyle = {
  fontWeight: 'bold',
  color: '#2d6cdf',
  marginRight: '8px',
};

const valueStyle = {
  color: '#333',
};

const titleStyle = {
  fontSize: '1.5rem',
  fontWeight: 'bold',
  marginBottom: '10px',
  color: '#1a3a6d',
};

const MatchCard = ({ match }) => {
  if (!match) return null;

  const dateObj = new Date(match.matchTime);
  const dateStr = dateObj.toLocaleDateString();
  const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>{match.title}</div>
      <div>
        <span style={labelStyle}>Date:</span>
        <span style={valueStyle}>{dateStr}</span>
      </div>
      <div>
        <span style={labelStyle}>Time:</span>
        <span style={valueStyle}>{timeStr}</span>
      </div>
      <div>
        <span style={labelStyle}>Location:</span>
        <span style={valueStyle}>{match.location}</span>
      </div>
      {match.description && (
        <div>
          <span style={labelStyle}>Description:</span>
          <span style={valueStyle}>{match.description}</span>
        </div>
      )}
    </div>
  );
};

export default MatchCard;
