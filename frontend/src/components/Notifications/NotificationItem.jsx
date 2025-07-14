import React from 'react';

const NotificationItem = ({ notification, onMarkAsRead }) => {
  return (
    <li className={`flex items-center justify-between p-3 rounded ${notification.read ? 'bg-gray-100' : 'bg-yellow-100'}`}>
      <span>{notification.message}</span>
      {!notification.read && (
        <button
          className="ml-4 text-blue-600 hover:underline"
          onClick={() => onMarkAsRead(notification.id)}
        >
          Mark as read
        </button>
      )}
      {notification.read && (
        <span className="ml-4 text-xs text-gray-500">Read</span>
      )}
    </li>
  );
};

export default NotificationItem;
