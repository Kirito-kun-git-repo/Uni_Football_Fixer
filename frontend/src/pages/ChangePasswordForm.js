import React, { useState } from 'react';
import api from '../api/axios';

function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    setError('');
    setLoading(true);
    try {
      await api.put('/team/change-password', form);
      setMsg('Password changed successfully!');
      setForm({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 32 }}>
      <h3>Change Password</h3>
      {msg && <div style={{ color: 'green' }}>{msg}</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <input
        name="currentPassword"
        value={form.currentPassword}
        onChange={handleChange}
        type="password"
        placeholder="Current Password"
        required
      />
      <input
        name="newPassword"
        value={form.newPassword}
        onChange={handleChange}
        type="password"
        placeholder="New Password"
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Changing...' : 'Change Password'}
      </button>
    </form>
  );
}

export default ChangePasswordForm;
