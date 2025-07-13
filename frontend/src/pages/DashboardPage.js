import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import ProfileForm from './ProfileForm';
import ChangePasswordForm from './ChangePasswordForm';

function DashboardPage() {
  const { user, login } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      try {
        const res = await api.get('/team/profile');
        setProfile(res.data);
      } catch (err) {
        setProfileError('Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleProfileUpdate = async (formData) => {
    setProfileMsg('');
    setProfileError('');
    try {
      const res = await api.put('/team/profile', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfile(res.data.team);
      setProfileMsg('Profile updated successfully!');
      // Update auth context with new user info
      login(res.data.team, sessionStorage.getItem('jwt'));
    } catch (err) {
      setProfileError(err.response?.data?.message || 'Failed to update profile');
    }
  };

  if (loading) return <div>Loading...</div>;
  if (profileError) return <div style={{ color: 'red' }}>{profileError}</div>;

  return (
    <div>
      <h2>Team Dashboard</h2>
      <ProfileForm profile={profile} onUpdate={handleProfileUpdate} msg={profileMsg} error={profileError} />
      <ChangePasswordForm />
    </div>
  );
}

export default DashboardPage;
