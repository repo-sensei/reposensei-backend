const express = require('express');
const { answerQuestion } = require('../services/chatService');
const supabase = require('../config/supabase');

const router = express.Router();

// POST /api/chat/ask
router.post('/ask', async (req, res) => {
  try {
    const { repoId, userId, question } = req.body;
    const answer = await answerQuestion(repoId, userId, question);
    return res.status(200).json({ success: true, answer });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/chat/logs/:repoId
router.get('/logs/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    const { data, error } = await supabase
      .from('chat_logs')
      .select('*')
      .eq('repo_id', repoId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.status(200).json({ success: true, logs: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
