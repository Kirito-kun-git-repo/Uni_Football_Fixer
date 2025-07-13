import React from 'react';
import { useAuth } from '../context/AuthContext';

function HomePage() {
  const { user } = useAuth();
  return (
    <div>
      <h1>Welcome to Football Fixer!</h1>
      <p>Logged in as: {user?.teamName || user?.email}</p>
    </div>
  );
}

export default HomePage;
