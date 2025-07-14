import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import teamService from '../../api/teamService';

const TeamProfile = () => {
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!team) return null;

  return (
    <div className="max-w-xl mx-auto mt-12 p-8 bg-white shadow rounded">
      <h2 className="text-2xl font-bold mb-4">Team Profile</h2>
      <div className="mb-4">
        <span className="font-semibold">Team Name:</span> {team.name}
      </div>
      <div className="mb-4">
        <span className="font-semibold">Members:</span>
        <ul className="list-disc ml-6">
          {(team.members || []).map((member, idx) => (
            <li key={idx}>{member}</li>
          ))}
        </ul>
      </div>
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        onClick={() => navigate('/team/edit')}
      >
        Edit Profile
      </button>
    </div>
  );
};

export default TeamProfile;
