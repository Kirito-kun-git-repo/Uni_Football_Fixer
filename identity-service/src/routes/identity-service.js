const express= require('express');
const router =express.Router();
const {registration,loginUser, refreshTokenUser,logoutUser,getTeamById}=require('../controllers/identitty-controller');
const {authenticateRequest}=require('../middleware/authMiddleware');



router.post('/register',registration)
router.post('/login',loginUser)
router.post('/refresh-token',refreshTokenUser);
router.post('/logout',logoutUser);
router.get('/getTeamById/:teamId',getTeamById);

module.exports = router;