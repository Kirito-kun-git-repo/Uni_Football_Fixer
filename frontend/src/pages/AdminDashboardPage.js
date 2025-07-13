import React, { useState } from 'react';
import AdminTeams from '../components/admin/AdminTeams';
import AdminMatches from '../components/admin/AdminMatches';
import AdminAdmins from '../components/admin/AdminAdmins';

const tabs = [
  { name: 'Teams', component: <AdminTeams /> },
  { name: 'Matches', component: <AdminMatches /> },
  { name: 'Admins', component: <AdminAdmins /> },
];

function AdminDashboardPage() {
  const [tab, setTab] = useState(0);
  return (
    <div style={{ padding: 24 }}>
      <h2>Admin Dashboard</h2>
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
