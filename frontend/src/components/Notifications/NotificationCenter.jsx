import React, { useEffect, useState } from 'react';
import notificationService from '../../api/notificationService';
import NotificationItem from './NotificationItem';
// Optionally use NotificationContext if you want to sync global state

const NotificationCenter = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchNotifications = async () => {
      setLoading(true);
      try {
        const data = await notificationService.getNotifications();
        setNotifications(data || []);
      } catch (err) {
        setError('Failed to load notifications');
      } finally {
        setLoading(false);
      }
    };
    fetchNotifications();
  }, []);

  const markAsRead = async (id) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications((prev) => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      // Optionally show error
    }
  };

  if (loading) return <div className="p-8">Loading notifications...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <div className="max-w-xl mx-auto mt-12 p-8 bg-white shadow rounded">
      <h2 className="text-2xl font-bold mb-4">Notifications</h2>
      {notifications.length === 0 ? (
        <div>No notifications.</div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <NotificationItem key={n.id} notification={n} onMarkAsRead={markAsRead} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default NotificationCenter;
