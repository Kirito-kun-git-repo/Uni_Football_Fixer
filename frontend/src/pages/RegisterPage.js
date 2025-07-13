import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { useNavigate, Navigate } from 'react-router-dom';

function RegisterPage() {
  const { isAuthenticated, login, setLoading, loading } = useAuth();
  const [form, setForm] = useState({ teamName: '', collegeName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/register', form);
      login(res.data.team, res.data.token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Register</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <input name="teamName" value={form.teamName} onChange={handleChange} placeholder="Team Name" required />
      <input name="collegeName" value={form.collegeName} onChange={handleChange} placeholder="College Name" required />
      <input name="email" value={form.email} onChange={handleChange} type="email" placeholder="Email" required />
      <input name="password" value={form.password} onChange={handleChange} type="password" placeholder="Password" required />
      <button type="submit" disabled={loading}>{loading ? 'Registering...' : 'Register'}</button>
    </form>
  );
}

export default RegisterPage;
