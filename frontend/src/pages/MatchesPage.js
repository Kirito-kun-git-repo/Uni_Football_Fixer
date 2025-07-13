import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import MatchForm from './MatchForm';
import MatchInvites from './MatchInvites';

function MatchesPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editMatch, setEditMatch] = useState(null);

  useEffect(() => {
    fetchMatches();
  }, []);

  const fetchMatches = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/matches');
      setMatches(res.data);
    } catch (err) {
      setError('Failed to load matches');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditMatch(null);
    setShowForm(true);
  };

  const handleEdit = (match) => {
    setEditMatch(match);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this match?')) {
      try {
        await api.delete(`/matches/${id}`);
        fetchMatches();
      } catch (err) {
        alert('Failed to delete match');
      }
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditMatch(null);
    fetchMatches();
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div>
      <h2>Upcoming Matches</h2>
      <button onClick={handleCreate}>Create Match</button>
      <ul>
        {matches.map((match) => (
          <li key={match._id} style={{ marginBottom: 16 }}>
            <div>
              <strong>{match.title}</strong> (Date: {match.date} Time: {match.matchTime})
              <button onClick={() => handleEdit(match)} style={{ marginLeft: 8 }}>Edit</button>
              <button onClick={() => handleDelete(match._id)} style={{ marginLeft: 8 }}>Delete</button>
              <button onClick={() => window.location.href = `/matches/${match._id}`}>View Details</button>
            </div>
          </li>
        ))}
      </ul>
      {showForm && (
        <MatchForm match={editMatch} onClose={handleFormClose} />
      )}
      <MatchInvites />
    </div>
  );
}

export default MatchesPage;
