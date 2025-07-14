import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import teamService from '../../api/teamService';

const EditProfile = () => {
  const [team, setTeam] = useState({ name: '', members: [] });
  const [memberInput, setMemberInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTeam = async () => {
      setLoading(true);
      try {
        // TODO: Replace '1' with actual team ID from auth/user context
        const data = await teamService.getTeamById(1);
        setTeam(data);
      } catch (err) {
        setError('Failed to load team profile');
      } finally {
        setLoading(false);
      }
    };
    fetchTeam();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!team.name) {
      setError('Team name is required');
      return;
    }
    setLoading(true);
    try {
      await teamService.updateTeam(1, team); // TODO: Replace '1' with actual team ID
      setSuccess('Profile updated successfully');
      setTimeout(() => navigate('/team/profile'), 1200);
    } catch (err) {
      setError('Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = () => {
    if (memberInput && !team.members.includes(memberInput)) {
      setTeam({ ...team, members: [...team.members, memberInput] });
      setMemberInput('');
    }
  };

  const handleRemoveMember = (member) => {
    setTeam({ ...team, members: team.members.filter(m => m !== member) });
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <form onSubmit={handleSave} className="max-w-xl mx-auto mt-12 p-8 bg-white shadow rounded">
      <h2 className="text-2xl font-bold mb-4">Edit Team Profile</h2>
      {error && <div className="mb-4 text-red-600">{error}</div>}
      {success && <div className="mb-4 text-green-600">{success}</div>}
      <div className="mb-4">
        <label className="block mb-1 font-semibold">Team Name</label>
        <input
          type="text"
          className="w-full border px-3 py-2 rounded"
          value={team.name}
          onChange={e => setTeam({ ...team, name: e.target.value })}
          required
        />
      </div>
      <div className="mb-4">
        <label className="block mb-1 font-semibold">Members</label>
        <div className="flex mb-2">
          <input
            type="text"
            className="flex-1 border px-3 py-2 rounded mr-2"
            value={memberInput}
            onChange={e => setMemberInput(e.target.value)}
            placeholder="Add member"
          />
          <button
            type="button"
            className="bg-blue-500 text-white px-3 py-2 rounded hover:bg-blue-600"
            onClick={handleAddMember}
          >
            Add
          </button>
        </div>
        <ul className="list-disc ml-6">
          {team.members.map((member, idx) => (
            <li key={idx} className="flex items-center justify-between">
              <span>{member}</span>
              <button
                type="button"
                className="ml-2 text-red-600 hover:underline"
                onClick={() => handleRemoveMember(member)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="submit"
        className="w-full bg-green-600 text-white py-2 rounded font-semibold hover:bg-green-700 transition"
        disabled={loading}
      >
        {loading ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
};

export default EditProfile;
