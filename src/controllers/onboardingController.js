const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const onboardingService = require('../services/onboardingService');

// POST /api/onboarding/start
router.post('/start', async (req, res) => {
  try {
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

// POST /api/onboarding/next
router.post('/next', async (req, res) => {
  try {
    const { userId, repoId, input } = req.body;

    if (!userId || typeof input !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing userId or input' });
    }

    const step = await onboardingService.nextStep(userId, input);

    res.json({ success: true, step });
  } catch (e) {
    console.error('Onboarding next step error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
// POST /api/onboarding/overview/generate
router.post('/overview/generate', async (req, res) => {
  try {
    const { userId, repoId } = req.body;
    const overviewId = await onboardingService.generateOverview(userId, repoId);
    res.json({ success: true, overviewId });
  } catch (e) {
    console.error('Overview generation error:', e);
    res.status(500).json({ error: 'Failed to generate overview' });
  }
});

router.post('/critical-tasks/generate', async (req, res) => {
  try {
    const { userId, repoId } = req.body;
    await onboardingService.generateTasks(userId, repoId);

    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select('flow')
      .eq('user_id', userId)
      .eq('repo_id', repoId)  // 🛠️ Important!
      .single();

    if (error || !data) {
      return res.status(500).json({ error: 'Failed to fetch updated flow' });
    }

    const flow = data.flow;
    const lastTaskStep = [...flow.history].reverse().find(
      step => step.tasks && step.tasks.length > 0
    );

    if (!lastTaskStep) {
      return res.status(404).json({ error: 'No task step found in flow history' });
    }

    res.json({ step: lastTaskStep });  // ✅ Contains .tasks now
  } catch (e) {
    console.error('Critical tasks generation error:', e);
    res.status(500).json({ error: 'Failed to generate critical tasks' });
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
