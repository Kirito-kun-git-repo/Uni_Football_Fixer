import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { useNavigate, Navigate } from 'react-router-dom';

function LoginPage() {
  const { isAuthenticated, login, setLoading, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('team'); // 'team' or 'admin'
  const [error, setError] = useState('');
  const navigate = useNavigate();

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let res;
      if (role === 'team') {
        res = await api.post('/auth/login', { email, password });
        login(res.data.team, res.data.token, 'team');
        navigate('/');
      } else {
        res = await api.post('/admin/login', { email, password });
        login(res.data.admin, res.data.token, 'admin');
        navigate('/admin');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Login</h2>
      <div style={{ marginBottom: '10px' }}>
        <label>
          <input
            type="radio"
            name="role"
            value="team"
            checked={role === 'team'}
            onChange={() => setRole('team')}
          />
          Team
        </label>
        <label style={{ marginLeft: '20px' }}>
          <input
            type="radio"
            name="role"
            value="admin"
            checked={role === 'admin'}
            onChange={() => setRole('admin')}
          />
          Admin
        </label>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required />
      <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" required />
      <button type="submit" disabled={loading}>{loading ? 'Logging in...' : 'Login'}</button>
    </form>
  );
}

export default LoginPage;
