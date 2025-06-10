// src/controllers/onboardingController.js

const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const onboardingService = require('../services/onboardingService');

// POST /api/onboarding/start
router.post('/start', async (req, res) => {
  try {
    // Pull userId and repoId from req.body directly
    const { userId, repoId } = req.body;
    if (!userId || !repoId) {
      return res.status(400).json({ success: false, error: 'Missing userId or repoId' });
    }

    const step = await onboardingService.startFlow(userId, repoId);
    res.json({ success: true, step });
  } catch (e) {
    console.error('Start onboarding error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/onboarding/step
router.post('/step', async (req, res) => {
  try {
    // Pull userId and input from req.body
    const { userId, input } = req.body;
    if (!userId || typeof input !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing userId or input' });
    }

    const result = await onboardingService.nextStep(userId, input);
    res.json({ success: true, result });
  } catch (e) {
    console.error('Onboarding step error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/onboarding/overview/:id
router.get('/overview/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('onboarding_overviews')
      .select('html')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).send('Overview not found');
    }

    res.type('text/html').send(data.html);
  } catch (e) {
    console.error('Fetch overview error:', e);
    res.status(500).send('Failed to retrieve overview');
  }
});

module.exports = router;
