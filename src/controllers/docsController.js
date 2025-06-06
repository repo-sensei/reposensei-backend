const express = require('express');
const { generateMermaidGraph, renderMermaidToSvg } = require('../services/diagramService');
const { computeHotspots } = require('../services/debtService');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// GET /api/docs/architecture/:repoId
router.get('/architecture/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    const mermaidFile = await generateMermaidGraph(repoId);
    
    // Option A: return Mermaid code so frontend can render it
    const mermaidCode = await fs.promises.readFile(mermaidFile, 'utf-8');
    return res.status(200).json({ success: true, mermaid: mermaidCode });
    // Option B: return SVG URL if you rendered it
    // const svgFile = await renderMermaidToSvg(mermaidFile);
    // return res.status(200).json({ success: true, svgUrl: `/generated/${repoId}-graph.svg` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/docs/hotspots/:repoId
router.get('/hotspots/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    // Assume the repo was cloned to a temp folder by repoController
    // const tmpBase = path.join(os.tmpdir(), 'reposensei'); const repoPath = path.join(tmpBase, repoId); -> inside gitService.js
    const repoPath = path.join(require('os').tmpdir(), 'reposensei', repoId);
    const hotspots = await computeHotspots(repoId, repoPath);
    return res.status(200).json({ success: true, hotspots });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
