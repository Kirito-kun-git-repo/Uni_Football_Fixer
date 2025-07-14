import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import matchService from '../../api/matchService';

const MatchDetail = () => {
  const { id } = useParams();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchMatch = async () => {
      setLoading(true);
      try {
        const data = await matchService.getMatchById(id);
        setMatch(data);
      } catch (err) {
        setError('Failed to load match details');
      } finally {
        setLoading(false);
      }
    };
    fetchMatch();
  }, [id]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!match) return null;

  const formattedTime = match.matchTime ? new Date(match.matchTime).toLocaleString() : 'TBD';

  return (
    <div className="max-w-xl mx-auto mt-12 p-8 bg-white shadow rounded">
      <h2 className="text-2xl font-bold mb-4">Match Details</h2>
      <div className="mb-2">
        <span className="font-semibold">Teams:</span> {match.teamA} vs {match.teamB}
      </div>
      <div className="mb-2">
        <span className="font-semibold">Time:</span> {formattedTime}
      </div>
      <div className="mb-2">
        <span className="font-semibold">Location:</span> {match.location}
      </div>
      {/* Add any extra match info here */}
    </div>
  );
};

export default MatchDetail;
