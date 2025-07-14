import React, { useEffect, useState } from 'react';
import adminService from '../../api/adminService';

const AdminDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const dashboardData = await adminService.getDashboardData();
        setData(dashboardData);
      } catch (err) {
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <div className="p-8">Loading admin dashboard...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="max-w-2xl mx-auto mt-12 p-8 bg-white shadow rounded">
      <h2 className="text-2xl font-bold mb-4">Admin Dashboard</h2>
      {/* Example summary stats, adjust fields as needed */}
      <div className="mb-4">
        <span className="font-semibold">Total Teams:</span> {data.totalTeams || 0}
      </div>
      <div className="mb-4">
        <span className="font-semibold">Total Matches:</span> {data.totalMatches || 0}
      </div>
      <div className="mb-4">
        <span className="font-semibold">Total Users:</span> {data.totalUsers || 0}
      </div>
      {/* Add more admin features here as needed */}
    </div>
  );
};

export default AdminDashboard;
