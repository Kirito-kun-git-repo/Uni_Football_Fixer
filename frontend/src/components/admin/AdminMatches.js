import React, { useEffect, useState } from 'react';
import api from '../../api/axios';

function AdminMatches() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editMatch, setEditMatch] = useState(null);
  const [form, setForm] = useState({ teamA: '', teamB: '', location: '', description: '', date: '', matchTime: '' }); // date: yyyy-mm-dd, matchTime: hh:mm

  const fetchMatches = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/matches');
      setMatches(res.data);
    } catch (err) {
      setError('Failed to fetch matches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMatches(); }, []);

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async e => {
    e.preventDefault();
    // Validate date and time
    if (!form.date || !form.matchTime) {
      setError('Please provide both date and time for the match.');
      return;
    }
    const matchTimeString = `${form.date}T${form.matchTime}`;
    const matchTimeISO = new Date(matchTimeString).toISOString();
    if (matchTimeISO === 'Invalid Date') {
      setError('Invalid date or time. Please check your input.');
      return;
    }
    try {
      // Only send the fields required by backend
      const payload = {
        teamA: form.teamA,
        teamB: form.teamB,
        location: form.location,
        matchTime: matchTimeISO,
      };
      if (form.description) payload.description = form.description;
      if (editMatch) {
        await api.put(`/matches/${editMatch._id}`, payload);
      } else {
        await api.post('/matches', payload);
      }
      setForm({ teamA: '', teamB: '', date: '', matchTime: '' });
      setEditMatch(null);
      fetchMatches();
    } catch {
      setError('Failed to save match');
    }
  };

  const handleEdit = match => {
    setEditMatch(match);
    // Extract date and time from ISO string for form fields
    const date = match.matchTime ? match.matchTime.slice(0, 10) : '';
    const matchTime = match.matchTime ? match.matchTime.slice(11, 16) : '';
    setForm({ teamA: match.teamA, teamB: match.teamB, date, matchTime });
  };

  const handleDelete = async id => {
    if (!window.confirm('Delete this match?')) return;
    try {
      await api.delete(`/matches/${id}`);
      fetchMatches();
    } catch {
      setError('Failed to delete match');
    }
  };

  return (
    <div>
      <h3>Matches</h3>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          name="teamA"
          placeholder="Team A"
          value={form.teamA}
          onChange={handleChange}
          required
        />
        <input
          type="text"
          name="teamB"
          placeholder="Team B"
          value={form.teamB}
          onChange={handleChange}
          required
        />
        <input
          type="date"
          name="date"
          value={form.date}
          onChange={handleChange}
          required
        />
        <input
          type="time"
          name="matchTime"
          value={form.matchTime}
          onChange={handleChange}
          required
        />
        <button type="submit">{editMatch ? 'Update' : 'Create'}</button>
        {editMatch && (
          <button
            type="button"
            onClick={() => {
              setEditMatch(null);
              setForm({ teamA: '', teamB: '', date: '', matchTime: '' });
            }}
          >
            Cancel
          </button>
        )}
      </form>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <table border="1" cellPadding="8">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Team A</th>
              <th>Team B</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match) => (
              <tr key={match._id}>
                <td>{match.date}</td>
                <td>{match.matchTime}</td>
                <td>{match.teamA}</td>
                <td>{match.teamB}</td>
                <td>
                  <button onClick={() => handleEdit(match)}>Edit</button>
                  <button onClick={() => handleDelete(match._id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default AdminMatches;
