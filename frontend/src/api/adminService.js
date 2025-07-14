import axios from '../utils/axiosConfig';

const adminService = {
  login: async ({ email, password }) => {
    const res = await axios.post('/api/admin/auth/login', { email, password });
    return res.data;
  },
  getDashboardData: async () => {
    const res = await axios.get('/api/admin/dashboard'); // adjust endpoint as needed
    return res.data;
  },
};

export default adminService;
