const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateCytoscapeGraph } = require('../services/diagramService');
const { computeHotspots, fetchRefactorSuggestions } = require('../services/debtService');

const router = express.Router();


router.get('/architecture/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;

    // 1) Generate Cytoscape-compatible JSON graph
    const graphFile = await generateCytoscapeGraph(repoId);

    // 2) Build a public URL (assumes /generated is statically served)
    const fileName = path.basename(graphFile);
    const jsonUrl = `/generated/${fileName}`;

    return res.status(200).json({ success: true, jsonUrl });
  } catch (err) {
    console.error('Error in /api/docs/architecture:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// GET /api/docs/hotspots/:repoId
router.get('/hotspots/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    const repoPath = path.join(os.tmpdir(), 'reposensei', repoId);
    const hotspots = await computeHotspots(repoId, repoPath);

    return res.status(200).json({ success: true, hotspots });
  } catch (err) {
    console.error('Error in /api/docs/hotspots:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/hotspots/:repoId/:nodeId/suggestions', async (req, res) => {
  try {
    const { repoId, nodeId } = req.params;
    const repoPath = path.join(os.tmpdir(), 'reposensei', repoId);
    const suggestions = await fetchRefactorSuggestions(nodeId, repoPath);
    return res.status(200).json({ success: true, suggestions });
  } catch (err) {
    console.error(`Error fetching suggestions for node ${req.params.nodeId}:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
