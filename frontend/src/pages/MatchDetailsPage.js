import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/axios';

function MatchDetailsPage() {
  const { id } = useParams();
  const [match, setMatch] = useState(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDetails();
  }, []);

  const fetchDetails = async () => {
    setLoading(true);
    setError('');
    try {
      const matchRes = await api.get(`/matches/${id}`);
      setMatch(matchRes.data);
      // Optionally fetch invites for this match if endpoint exists
      try {
        const invitesRes = await api.get(`/invites/match/${id}`);
        setInvites(invitesRes.data);
      } catch {}
    } catch (err) {
      setError('Failed to load match details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (!match) return <div>Match not found</div>;

  return (
    <div>
      <h2>{match.title}</h2>
      <div>Date: {match.date} Time: {match.matchTime}</div>
      <div>Location: {match.location}</div>
      <div>Description: {match.description}</div>
      <h3>Invites</h3>
      <ul>
        {invites.map(invite => (
          <li key={invite._id}>
            From: {invite.fromTeam?.teamName || invite.fromTeam} | Status: {invite.status}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default MatchDetailsPage;
