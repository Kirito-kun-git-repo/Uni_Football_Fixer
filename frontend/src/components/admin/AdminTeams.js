import React, { useEffect, useState } from 'react';
import api from '../../api/axios';

function AdminTeams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editTeam, setEditTeam] = useState(null);
  const [form, setForm] = useState({ name: '', college: '' });

  const fetchTeams = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/teams');
      setTeams(res.data);
    } catch (err) {
      setError('Failed to fetch teams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTeams(); }, []);

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      if (editTeam) {
        await api.put(`/admin/teams/${editTeam._id}`, form);
      } else {
        await api.post('/admin/teams', form);
      }
      setForm({ name: '', college: '' });
      setEditTeam(null);
      fetchTeams();
    } catch {
      setError('Failed to save team');
    }
  };

  const handleEdit = team => {
    setEditTeam(team);
    setForm({ name: team.name, college: team.college });
  };

  const handleDelete = async id => {
    if (!window.confirm('Delete this team?')) return;
    try {
      await api.delete(`/admin/teams/${id}`);
      fetchTeams();
    } catch {
      setError('Failed to delete team');
    }
  };

  return (
    <div>
      <h3>Teams</h3>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <input name="name" value={form.name} onChange={handleChange} placeholder="Team Name" required />
        <input name="college" value={form.college} onChange={handleChange} placeholder="College" required />
        <button type="submit">{editTeam ? 'Update' : 'Create'}</button>
        {editTeam && <button type="button" onClick={() => { setEditTeam(null); setForm({ name: '', college: '' }); }}>Cancel</button>}
      </form>
      {loading ? <div>Loading...</div> : (
        <table border="1" cellPadding="8">
          <thead><tr><th>Name</th><th>College</th><th>Actions</th></tr></thead>
          <tbody>
            {teams.map(team => (
              <tr key={team._id}>
                <td>{team.name}</td>
                <td>{team.college}</td>
                <td>
                  <button onClick={() => handleEdit(team)}>Edit</button>
                  <button onClick={() => handleDelete(team._id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default AdminTeams;
