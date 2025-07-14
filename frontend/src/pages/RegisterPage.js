import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { useNavigate, Navigate } from 'react-router-dom';

function RegisterPage() {
  const { isAuthenticated, login, setLoading, loading } = useAuth();
  const [form, setForm] = useState({ teamName: '', collegeName: '', email: '', password: '' });
  const [profilePicture, setProfilePicture] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setProfilePicture(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }
  };

  const validate = () => {
    if (!form.teamName.trim() || !form.collegeName.trim() || !form.email.trim() || !form.password.trim()) {
      setError('All fields are required.');
      return false;
    }
    // Simple email regex
    if (!/^\S+@\S+\.\S+$/.test(form.email)) {
      setError('Please enter a valid email address.');
      return false;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return false;
    }
    if (!profilePicture) {
      setError('Profile photo is required.');
      return false;
    }
    if (profilePicture && profilePicture.size > 5 * 1024 * 1024) {
      setError('Profile photo must be less than 5MB.');
      return false;
    }
    if (profilePicture && !profilePicture.type.startsWith('image/')) {
      setError('Profile photo must be an image.');
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([key, value]) => formData.append(key, value));
      if (profilePicture) formData.append('profilePicture', profilePicture);
      const res = await api.post('/auth/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
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
      <input name="profilePicture" type="file" accept="image/*" onChange={handleFileChange} />
      {preview && (
        <div style={{ margin: '10px 0' }}>
          <img src={preview} alt="Profile Preview" style={{ width: 80, height: 80, borderRadius: '50%' }} />
        </div>
      )}
      <button type="submit" disabled={loading || !form.teamName || !form.collegeName || !form.email || !form.password || !profilePicture}>
        {loading ? 'Registering...' : 'Register'}
      </button>
    </form>
  );
}

export default RegisterPage;
