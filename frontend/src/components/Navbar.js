import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';

function Navbar() {
  const { isAuthenticated, logout, user } = useAuth();
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleNotifications = () => {
    navigate('/notifications');
  };

  return (
    <nav>
      <Link to="/">Football Fixer</Link>
      {isAuthenticated ? (
        <>
          <span>Welcome, {user?.teamName || user?.email}</span>
          <Link to="/matches" style={{ marginLeft: 16 }}>Matches</Link>
          <button onClick={handleNotifications} style={{ position: 'relative', marginLeft: 16 }}>
            Notifications
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute',
                top: -8,
                right: -8,
                background: 'red',
                color: 'white',
                borderRadius: '50%',
                padding: '2px 6px',
                fontSize: 12
              }}>{unreadCount}</span>
            )}
          </button>
          <button onClick={handleLogout}>Logout</button>
        </>
      ) : (
        <>
          <Link to="/login">Login</Link>
          <Link to="/register">Register</Link>
        </>
      )}
    </nav>
  );
}

export default Navbar;
