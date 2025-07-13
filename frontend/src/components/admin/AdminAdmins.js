import React, { useEffect, useState } from 'react';
import api from '../../api/axios';

function AdminAdmins() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editAdmin, setEditAdmin] = useState(null);
  const [form, setForm] = useState({ email: '', name: '', password: '' });

  const fetchAdmins = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/admins');
      setAdmins(res.data);
    } catch (err) {
      setError('Failed to fetch admins');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAdmins(); }, []);

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      if (editAdmin) {
        await api.put(`/admin/admins/${editAdmin._id}`, form);
      } else {
        await api.post('/admin/admins', form);
      }
      setForm({ email: '', name: '', password: '' });
      setEditAdmin(null);
      fetchAdmins();
    } catch {
      setError('Failed to save admin');
    }
  };

  const handleEdit = admin => {
    setEditAdmin(admin);
    setForm({ email: admin.email, name: admin.name, password: '' });
  };

  const handleDelete = async id => {
    if (!window.confirm('Delete this admin?')) return;
    try {
      await api.delete(`/admin/admins/${id}`);
      fetchAdmins();
    } catch {
      setError('Failed to delete admin');
    }
  };

  return (
    <div>
      <h3>Admins</h3>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <input name="email" value={form.email} onChange={handleChange} placeholder="Email" required />
        <input name="name" value={form.name} onChange={handleChange} placeholder="Name" required />
        <input name="password" value={form.password} onChange={handleChange} placeholder="Password" type="password" required={!editAdmin} />
        <button type="submit">{editAdmin ? 'Update' : 'Create'}</button>
        {editAdmin && <button type="button" onClick={() => { setEditAdmin(null); setForm({ email: '', name: '', password: '' }); }}>Cancel</button>}
      </form>
      {loading ? <div>Loading...</div> : (
        <table border="1" cellPadding="8">
          <thead><tr><th>Email</th><th>Name</th><th>Actions</th></tr></thead>
          <tbody>
            {admins.map(admin => (
              <tr key={admin._id}>
                <td>{admin.email}</td>
                <td>{admin.name}</td>
                <td>
                  <button onClick={() => handleEdit(admin)}>Edit</button>
                  <button onClick={() => handleDelete(admin._id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default AdminAdmins;
