import React, { useEffect, useState } from 'react';
import api from '../api/axios';

function MatchInvites() {
  const [sent, setSent] = useState([]);
  const [received, setReceived] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchInvites();
  }, []);

  const fetchInvites = async () => {
    setLoading(true);
    setError('');
    try {
      const sentRes = await api.get('/invites/sent');
      const receivedRes = await api.get('/invites/received');
      setSent(sentRes.data);
      setReceived(receivedRes.data);
    } catch (err) {
      setError('Failed to load invites');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (inviteId, action) => {
    try {
      await api.put(`/invites/${inviteId}/${action}`);
      fetchInvites();
    } catch {
      alert('Failed to update invite');
    }
  };

  if (loading) return <div>Loading invites...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div style={{ marginTop: 32 }}>
      <h3>Sent Invites</h3>
      <ul>
        {sent.map(invite => (
          <li key={invite._id}>
            Match: {invite.matchId?.title || invite.matchId} | Status: {invite.status}
          </li>
        ))}
      </ul>
      <h3>Received Invites</h3>
      <ul>
        {received.map(invite => (
          <li key={invite._id}>
            From: {invite.fromTeam?.teamName || invite.fromTeam} | Match: {invite.matchId?.title || invite.matchId} | Status: {invite.status}
            {invite.status === 'pending' && (
              <>
                <button onClick={() => handleAction(invite._id, 'accept')}>Accept</button>
                <button onClick={() => handleAction(invite._id, 'decline')}>Decline</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default MatchInvites;
