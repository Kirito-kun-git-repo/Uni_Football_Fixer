import React, { useEffect, useState } from 'react';
import { useNotifications } from '../context/NotificationContext';

function NotificationsPage() {
  const { notifications, loading, error, markAsRead, markAllAsRead } = useNotifications();

  if (loading) return <div>Loading notifications...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div>
      <h2>Notifications</h2>
      <button onClick={markAllAsRead}>Mark All as Read</button>
      <ul>
        {notifications.map((n) => (
          <li key={n._id} style={{ fontWeight: n.read ? 'normal' : 'bold', marginBottom: 8 }}>
            {n.message}
            {!n.read && (
              <button onClick={() => markAsRead(n._id)} style={{ marginLeft: 8 }}>Mark as Read</button>
            )}
            <span style={{ marginLeft: 16, fontSize: 12, color: '#888' }}>{new Date(n.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default NotificationsPage;
