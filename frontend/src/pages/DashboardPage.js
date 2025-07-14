import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const [stats, setStats] = useState({ matches: 0, invites: 0, unreadNotifications: 0 });

  useEffect(() => {
    const fetchProfileAndStats = async () => {
      setLoading(true);
      try {
        const [profileRes, matchesRes, invitesRes, notificationsRes] = await Promise.all([
          api.get('/team/profile'),
          api.get('/matches?my=1'), // Adjust endpoint if needed for matches played by this team
          api.get('/invites'),      // Invites for this team
          api.get('/notifications'),
        ]);
        setProfile(profileRes.data);
        setStats({
          matches: matchesRes.data.length || 0,
          invites: invitesRes.data.length || 0,
          unreadNotifications: (notificationsRes.data.filter(n => !n.read).length) || 0,
        });
      } catch (err) {
        setProfileError('Failed to load profile or stats');
      } finally {
        setLoading(false);
      }
    };
    fetchProfileAndStats();
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
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 24 }}>
        {profile?.profilePicture && (
          <img
            src={
              profile.profilePicture.startsWith('http')
                ? profile.profilePicture
                : `${process.env.REACT_APP_API_BACKEND_URL || 'http://localhost:3000'}/uploads/profile_pictures/${profile.profilePicture}`
            }
            alt="Profile"
            style={{ width: 100, height: 100, borderRadius: '50%', objectFit: 'cover', border: '2px solid #eee' }}
          />
        )}
        <div>
          <h2 style={{ margin: 0 }}>Welcome, {profile?.teamName}!</h2>
          <div style={{ color: '#888' }}>{profile?.collegeName}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 'bold' }}>{stats.matches}</div>
          <div>Matches Played</div>
        </div>
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 'bold' }}>{stats.invites}</div>
          <div>Invites</div>
        </div>
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: stats.unreadNotifications ? '#d32f2f' : '#333' }}>{stats.unreadNotifications}</div>
          <div>Unread Notifications</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        <button onClick={() => navigate('/matches')}>Matches</button>
        <button onClick={() => navigate('/invites')}>Invites</button>
        <button onClick={() => navigate('/notifications')}>Notifications</button>
        <button onClick={() => navigate('/chat')}>Chat</button>
        <button onClick={() => navigate('/profile')}>Profile</button>
      </div>
      <ProfileForm profile={profile} onUpdate={handleProfileUpdate} msg={profileMsg} error={profileError} />
      <ChangePasswordForm />
    </div>
  );
}

export default DashboardPage;
