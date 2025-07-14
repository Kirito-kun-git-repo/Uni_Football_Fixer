import React, { useEffect, useState } from 'react';
import matchService from '../../api/matchService';
import MatchCard from './MatchCard';

const MatchList = () => {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchMatches = async () => {
      setLoading(true);
      try {
        const data = await matchService.getMatches();
        setMatches(data || []);
      } catch (err) {
        setError('Failed to load matches');
      } finally {
        setLoading(false);
      }
    };
    fetchMatches();
  }, []);

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <div className="max-w-2xl mx-auto mt-12">
      <h2 className="text-2xl font-bold mb-6">Upcoming Matches</h2>
      {matches.length === 0 ? (
        <div>No matches found.</div>
      ) : (
        <div className="space-y-4">
          {matches.map(match => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      )}
    </div>
  );
};

export default MatchList;
