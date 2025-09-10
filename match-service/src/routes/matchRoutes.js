const express = require('express');
const router = express.Router();
const {getAllMatches,getMatchById,createMatch,getMyMatches}=require('../controllers/match-Controller')
router.post('/create-match',createMatch);
router.get('/get-matches',getAllMatches);
router.get('/get-my-matches/',getMyMatches);
router.get('/:id',getMatchById);

module.exports=router;