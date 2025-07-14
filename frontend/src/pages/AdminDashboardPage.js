import React, { useState } from 'react';
import AdminTeams from '../components/admin/AdminTeams';
import AdminMatches from '../components/admin/AdminMatches';
import AdminAdmins from '../components/admin/AdminAdmins';

const tabs = [
  { name: 'Teams', component: <AdminTeams /> },
  { name: 'Matches', component: <AdminMatches /> },
  { name: 'Admins', component: <AdminAdmins /> },
];

import { useEffect } from 'react';
import api from '../api/axios';

function AdminDashboardPage() {
  const [tab, setTab] = useState(0);
  const [stats, setStats] = useState({ teams: 0, matches: 0, invites: 0, admins: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError('');
      try {
        const [teamsRes, matchesRes, invitesSentRes, invitesReceivedRes, adminsRes] = await Promise.all([
          api.get('/team'),
          api.get('/matches'),
          api.get('/invites/sent'),
          api.get('/invites/received'),
          api.get('/admin'),
        ]);
        setStats({
          teams: teamsRes.data.length || 0,
          matches: matchesRes.data.length || 0,
          invites: (invitesSentRes.data.length || 0) + (invitesReceivedRes.data.length || 0),
          admins: adminsRes.data.length || 0,
        });
      } catch (err) {
        setError('Failed to load admin stats');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h2>Admin Dashboard</h2>
      {loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div style={{ color: 'red' }}>{error}</div>
      ) : (
        <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 'bold' }}>{stats.teams}</div>
            <div>Teams</div>
          </div>
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 'bold' }}>{stats.matches}</div>
            <div>Matches</div>
          </div>
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 'bold' }}>{stats.invites}</div>
            <div>Total Invites</div>
          </div>
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 'bold' }}>{stats.admins}</div>
            <div>Admins</div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {tabs.map((t, i) => (
          <button key={t.name} onClick={() => setTab(i)} style={{ fontWeight: tab === i ? 'bold' : 'normal' }}>{t.name}</button>
        ))}
      </div>
      <div>{tabs[tab].component}</div>
    </div>
  );
}

export default AdminDashboardPage;
