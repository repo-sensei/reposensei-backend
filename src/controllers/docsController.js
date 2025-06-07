const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateDotGraph, renderDotToSvg } = require('../services/diagramService');
const { computeHotspots, fetchRefactorSuggestions } = require('../services/debtService');

const router = express.Router();

// NOTE: In your main app (e.g. index.js), serve the generated SVGs as static:
// app.use('/generated', express.static(path.join(__dirname, '../docs/generated')));

// GET /api/docs/architecture/:repoId
// Generates the Graphviz SVG and returns its public URL for client-side rendering
router.get('/architecture/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    // 1) Generate .dot file
    const dotFile = await generateDotGraph(repoId);
    // 2) Render to SVG
    const svgFile = await renderDotToSvg(dotFile);
    // 3) Build a public URL (assumes /generated is statically served)
    const fileName = path.basename(svgFile);
    const svgUrl = `/generated/${fileName}`;

    return res.status(200).json({ success: true, svgUrl });
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
