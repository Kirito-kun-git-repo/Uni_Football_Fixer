import React, { useState } from 'react';
import matchService from '../../api/matchService';

const CreateMatchForm = () => {
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [matchTime, setMatchTime] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const validateInputs = () => {
    if (!teamA || !teamB || !matchTime || !location) {
      setError('All fields are required');
      return false;
    }
    if (teamA === teamB) {
      setError('Teams must be different');
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateInputs()) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      // Convert datetime-local to ISO string
      const isoMatchTime = new Date(matchTime).toISOString();
      await matchService.createMatch({ teamA, teamB, matchTime: isoMatchTime, location });
      setSuccess('Match created successfully');
      setTeamA(''); setTeamB(''); setMatchTime(''); setLocation('');
    } catch (err) {
      setError(err.message || 'Failed to create match');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto mt-12 p-8 bg-white shadow rounded">
      <h2 className="text-2xl font-bold mb-6">Create Match</h2>
      {error && <div className="mb-4 text-red-600">{error}</div>}
      {success && <div className="mb-4 text-green-600">{success}</div>}
      <div className="mb-4">
        <label className="block mb-1 font-semibold">Team A</label>
        <input
          type="text"
          className="w-full border px-3 py-2 rounded"
          value={teamA}
          onChange={e => setTeamA(e.target.value)}
          required
        />
      </div>
      <div className="mb-4">
        <label className="block mb-1 font-semibold">Team B</label>
        <input
          type="text"
          className="w-full border px-3 py-2 rounded"
          value={teamB}
          onChange={e => setTeamB(e.target.value)}
          required
        />
      </div>
      <div className="mb-4">
        <label className="block mb-1 font-semibold">Match Time</label>
        <input
          type="datetime-local"
          className="w-full border px-3 py-2 rounded"
          value={matchTime}
          onChange={e => setMatchTime(e.target.value)}
          required
        />
      </div>
      <div className="mb-6">
        <label className="block mb-1 font-semibold">Location</label>
        <input
          type="text"
          className="w-full border px-3 py-2 rounded"
          value={location}
          onChange={e => setLocation(e.target.value)}
          required
        />
      </div>
      <button
        type="submit"
        className="w-full bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700 transition"
        disabled={loading}
      >
        {loading ? 'Creating...' : 'Create Match'}
      </button>
    </form>
  );
};

export default CreateMatchForm;
