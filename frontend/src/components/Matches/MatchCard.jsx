import React from 'react';
import { useNavigate } from 'react-router-dom';

const MatchCard = ({ match }) => {
  const navigate = useNavigate();
  const { id, teamA, teamB, matchTime, location } = match;
  const formattedTime = matchTime ? new Date(matchTime).toLocaleString() : 'TBD';

  return (
    <div className="bg-gray-100 p-4 rounded shadow flex items-center justify-between">
      <div>
        <div className="font-semibold text-lg">{teamA} vs {teamB}</div>
        <div className="text-sm text-gray-700">{formattedTime} &middot; {location}</div>
      </div>
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        onClick={() => navigate(`/matches/${id}`)}
      >
        View Details
      </button>
    </div>
  );
};

export default MatchCard;
