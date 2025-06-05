const express = require('express');
const Repo = require('../models/Repo');
const { summarizeChanges } = require('../services/changeService');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// GET /api/changes/:repoId?since=<ISODate>
router.get('/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    const sinceParam = req.query.since;
    const sinceDate = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 7 * 24 * 60 * 60 * 100);

    const summary = await summarizeChanges(repoId, sinceDate);
    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
