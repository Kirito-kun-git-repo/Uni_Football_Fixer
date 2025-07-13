import React, { useState } from 'react';
import api from '../api/axios';
import MatchCard from '../components/MatchCard';

function MatchForm({ match, onClose }) {
  const [createdMatch, setCreatedMatch] = useState(null);
  const [form, setForm] = useState({
    title: match?.title || '',
    date: match?.date || '',
    matchTime: match?.matchTime || '',
    location: match?.location || '',
    description: match?.description || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    // Validate date and time
    if (!form.date || !form.matchTime) {
      setError('Please provide both date and time for the match.');
      setLoading(false);
      return;
    }
    const matchTimeString = `${form.date}T${form.matchTime}`;
    const matchTimeISO = new Date(matchTimeString).toISOString();
    if (matchTimeISO === 'Invalid Date') {
      setError('Invalid date or time. Please check your input.');
      setLoading(false);
      return;
    }
    try {
      // Only send the fields required by backend
      const payload = {
        title: form.title,
        location: form.location,
        matchTime: matchTimeISO,
        description: form.description
      };
      if (match) {
        await api.put(`/matches/${match._id}`, payload);
        onClose(); // For edit, keep existing behavior
      } else {
        const res = await api.post('/matches', payload);
        setCreatedMatch(res.data);
      }
    } catch (err) {
      setError('Failed to save match');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div style={{ border: '1px solid #ccc', padding: 16, margin: 16 }}>
      <h3>{match ? 'Edit Match' : 'Create Match'}</h3>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {!createdMatch ? (
        <form onSubmit={handleSubmit}>
          <input name="title" value={form.title} onChange={handleChange} placeholder="Title" required />
          <input name="date" value={form.date} onChange={handleChange} type="date" required />
          <input name="matchTime" value={form.matchTime} onChange={handleChange} type="time" required />
          <input name="location" value={form.location} onChange={handleChange} placeholder="Location" required />
          <textarea name="description" value={form.description} onChange={handleChange} placeholder="Description" />
          <button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
          <button type="button" onClick={onClose} style={{ marginLeft: 8 }}>Cancel</button>
        </form>
      ) : (
        <>
          <MatchCard match={createdMatch} />
          <button onClick={onClose} style={{ marginTop: 16 }}>Close</button>
        </>
      )}
    </div>
  );
}

export default MatchForm;
