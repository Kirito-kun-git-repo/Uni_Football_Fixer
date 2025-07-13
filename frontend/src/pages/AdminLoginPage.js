import React, { useState } from 'react';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';

function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/auth/admin-login', { email, password });
      // Save admin JWT and role
      sessionStorage.setItem('jwt', res.data.token);
      sessionStorage.setItem('user', JSON.stringify(res.data.admin));
      navigate('/admin/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Admin login failed');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 400, margin: '40px auto' }}>
      <h2>Admin Login</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Admin Email" required />
      <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" required />
      <button type="submit">Login</button>
    </form>
  );
}

export default AdminLoginPage;
