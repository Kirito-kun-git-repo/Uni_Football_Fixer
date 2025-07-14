import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Sidebar from './components/UI/Sidebar';
import ProtectedRoute from './components/UI/ProtectedRoute';
import NotFoundPage from './pages/NotFoundPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { SocketProvider } from './context/SocketContext';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const MatchesPage = lazy(() => import('./pages/MatchesPage'));
const MatchDetailsPage = lazy(() => import('./pages/MatchDetailsPage'));
const MatchChatPage = lazy(() => import('./pages/MatchChatPage'));
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));

function AdminRoute({ children }) {
  const user = JSON.parse(sessionStorage.getItem('user'));
  return user && user.role === 'admin' ? children : <Navigate to="/admin/login" replace />;
}

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <SocketProvider>
          <Router>
            <Navbar />
            <div style={{ display: 'flex' }}>
              <Sidebar />
              <div style={{ flex: 1 }}>
                <Suspense fallback={<div style={{ padding: 32 }}>Loading...</div>}>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/dashboard" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
                    <Route path="/matches" element={<ProtectedRoute><MatchesPage /></ProtectedRoute>} />
                    <Route path="/matches/:id" element={<ProtectedRoute><MatchDetailsPage /></ProtectedRoute>} />
                    <Route path="/matches/:id/chat" element={<ProtectedRoute><MatchChatPage /></ProtectedRoute>} />
                    <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
                    <Route path="/admin/login" element={<AdminLoginPage />} />
                    <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
              </div>
            </div>
          </Router>
        </SocketProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
