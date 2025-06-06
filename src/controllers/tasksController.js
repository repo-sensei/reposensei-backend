const express = require('express');
const TaskModel = require('../models/Task');
const { generateOnboardingTasks } = require('../services/tasksService');
const path = require('path');

const router = express.Router();

// POST /api/tasks/generate
router.post('/generate', async (req, res) => {
  try {
    const { repoId } = req.body;
    const repoPath = path.join(require('os').tmpdir(), 'reposensei', repoId);

    // Always generate fresh tasks
    const newTasks = await generateOnboardingTasks({ repoId, repoPath });

    // Clear old tasks for this repo
    await TaskModel.deleteMany({ repoId });

    // Insert new ones
    await TaskModel.insertMany(newTasks);

    return res.status(200).json({ success: true, tasks: newTasks });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// GET /api/tasks/:repoId
router.get('/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    console.log('Received GET /api/tasks for repoId:', repoId);

    const tasks = await TaskModel.find({ repoId });
    console.log(`Found ${tasks.length} tasks for repoId ${repoId}`);

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
