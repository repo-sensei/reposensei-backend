const express = require('express');
const fs = require('fs');
const Repo = require('../models/Repo');
const NodeModel = require('../models/Node');
const CommitModel = require('../models/Commit');
const { cloneRepo, getCommitHistory } = require('../services/gitService');
const { collectSourceFiles, parseFile } = require('../services/astService');
const { upsertCodeEmbedding } = require('../services/vectorService');

const router = express.Router();

// POST /api/repo/scan
router.post('/scan', async (req, res) => {
  try {
    const { repoUrl, repoId, userId } = req.body;
    // 1) Clone
    const repoPath = await cloneRepo(repoUrl, repoId);

    // 2) Fetch commits
    const commits = await getCommitHistory(repoPath);
    for (const c of commits) {
      await CommitModel.create({
        repoId,
        sha: c.sha,
        message: c.message,
        author: c.author,
        date: new Date(c.date)
      });
      await upsertCodeEmbedding(repoId, 'commit', c.sha, c.message, {
        author: c.author,
        date: c.date
      });
    }

    // 3) AST parse all source files
    // After fetching commits
  console.log(`Fetched ${commits.length} commits`);

  // AST parsing step
  const files = collectSourceFiles(repoPath);
  console.log(`Collected ${files.length} source files`);

  for (const file of files) {
    
    const nodes = parseFile(file);
   

    for (const node of nodes) {
     
      await NodeModel.create({
        repoId,
        nodeId: node.nodeId,
        filePath: node.filePath,
        startLine: node.startLine,
        endLine: node.endLine,
        type: node.type,
        name: node.name,
        complexity: node.complexity,
        calledFunctions: node.calledFunctions
      });

      const srcContent = fs.readFileSync(node.filePath, 'utf-8');
      const snippet = srcContent
        .split('\n')
        .slice(node.startLine - 1, node.endLine)
        .join('\n');

      await upsertCodeEmbedding(repoId, 'node', node.nodeId, snippet, {
        filePath: node.filePath
      });
    }
  }

  console.log('Saving repo metadata');
  await Repo.create({
    repoId,
    repoUrl,
    userId,
    lastScanned: new Date()
  });

    return res.status(200).json({ success: true, message: 'Repo scanned successfully.' });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: 'Scan failed.', error: err.message });
  }
});

// GET /api/repo/list?userId=<userId>
router.get('/list', async (req, res) => {
  try {
    const { userId } = req.query;
    const repos = await Repo.find({ userId });
    return res.status(200).json({ success: true, repos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
