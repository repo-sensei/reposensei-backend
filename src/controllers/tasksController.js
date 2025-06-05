const express = require('express');
const TaskModel = require('../models/Task');
const { generateOnboardingTasks } = require('../services/tasksService');

const router = express.Router();

// POST /api/tasks/generate
router.post('/generate', async (req, res) => {
  try {
    const { repoId } = req.body;
    const repoPath = path.join(require('os').tmpdir(), 'reposensei', repoId);
    const tasks = await generateOnboardingTasks({ repoId, repoPath });
    return res.status(200).json({ success: true, tasks });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tasks/:repoId
router.get('/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    const tasks = await TaskModel.find({ repoId });
    return res.status(200).json({ success: true, tasks });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/tasks/:taskId/complete
router.put('/:taskId/complete', async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await TaskModel.findByIdAndUpdate(taskId, { isCompleted: true }, { new: true });
    return res.status(200).json({ success: true, task });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
