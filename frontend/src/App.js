import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const MatchesPage = lazy(() => import('./pages/MatchesPage'));
const MatchDetailsPage = lazy(() => import('./pages/MatchDetailsPage'));
const MatchChatPage = lazy(() => import('./pages/MatchChatPage'));
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';

function PrivateRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const user = JSON.parse(sessionStorage.getItem('user'));
  return user && user.role === 'admin' ? children : <Navigate to="/admin/login" replace />;
}

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <Router>
        <Navbar />
        <Suspense fallback={<div style={{padding: 32}}>Loading...</div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard" element={<PrivateRoute><HomePage /></PrivateRoute>} />
          <Route path="/matches" element={<PrivateRoute><MatchesPage /></PrivateRoute>} />
          <Route path="/matches/:id" element={<PrivateRoute><MatchDetailsPage /></PrivateRoute>} />
          <Route path="/matches/:id/chat" element={<PrivateRoute><MatchChatPage /></PrivateRoute>} />
          <Route path="/" element={<PrivateRoute><HomePage /></PrivateRoute>} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
        </Routes>
        </Suspense>
      </Router>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
