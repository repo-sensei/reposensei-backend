const express = require('express');
const fs = require('fs');
const path = require('path');
const Repo = require('../models/Repo');
const NodeModel = require('../models/Node');
const CommitModel = require('../models/Commit');
const { ensureRepoCloned, getRecentCommitsWithFiles } = require('../services/gitService');
const { collectSourceFiles, parseFile } = require('../services/astService');
const { upsertCodeEmbedding } = require('../services/vectorService');

const router = express.Router();

router.post('/scan', async (req, res) => {
  try {
    const { repoUrl, repoId, userId } = req.body;
    if (!repoUrl || !repoId || !userId) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing repoUrl, repoId, or userId' });
    }

    // 1) Clone (or pull) the repository locally
    const repoPath = await ensureRepoCloned(repoUrl, repoId);

    // 2) Fetch commits (up to 50) including filesChanged
    const commits = await getRecentCommitsWithFiles(repoPath);
    console.log(`Fetched ${commits.length} commits`);

    // 3) Insert each commit into Mongo + embed commit message & filesChanged
    for (const c of commits) {
      await CommitModel.updateOne(
        { sha: c.sha },
        {
          $setOnInsert: {
            repoId,
            sha: c.sha,
            message: c.message,
            author: c.author,
            date: new Date(c.date),
            filesChanged: c.filesChanged || []
          }
        },
        { upsert: true }
      );

      await upsertCodeEmbedding(
        repoId,
        'commit',
        c.sha,
        c.message,
        {
          author: c.author,
          date: c.date,
          files: c.filesChanged || []
        }
      );
    }

    // 4) AST‐parse all source files and insert nodes + embeddings
    const files = collectSourceFiles(repoPath);
    console.log(`Collected ${files.length} source files`);

    for (const file of files) {
      await NodeModel.deleteMany({ filePath: file });

      const nodes = parseFile(file, repoId, (() => {
        const relativePath = path.relative(repoPath, file);
        return path.dirname(relativePath).replace(/\\/g, '/') || 'root';
      })());

      const srcContent = fs.readFileSync(file, 'utf-8');

      for (const node of nodes) {
        // Save node document with new fields
        await NodeModel.create({
          repoId,
          nodeId: node.nodeId,
          filePath: node.filePath,
          module: node.module,
          startLine: node.startLine,
          endLine: node.endLine,
          type: node.type,
          name: node.name,
          complexity: node.complexity,
          complexityBreakdown: node.complexityBreakdown,
          calledFunctions: node.calledFunctions,
          calledBy: node.calledBy || [],          // Add calledBy here
          isExported: node.isExported,
          parentName: node.parentName,
          parameters: node.parameters,
          scopeLevel: node.scopeLevel,
          isAsync: node.isAsync,
          returnsValue: node.returnsValue || false,
          jsDocComment: node.jsDocComment || '',
          fileType: node.fileType || 'unknown',
          httpEndpoint: node.httpEndpoint || null,
          invokesAPI: node.invokesAPI || false,
          invokesDBQuery: node.invokesDBQuery || false,
          relatedComponents: node.relatedComponents || []
        });

        // Extract snippet lines for embedding
        const snippet = srcContent
          .split('\n')
          .slice(node.startLine - 1, node.endLine)
          .join('\n');

        await upsertCodeEmbedding(
          repoId,
          'node',
          node.nodeId,
          snippet,
          { filePath: node.filePath, module: node.module }
        );
      }
    }

    // 5) Save/update the Repo document with lastScanned timestamp
    await Repo.updateOne(
      { repoId },
      {
        $set: {
          repoUrl,
          userId,
          lastScanned: new Date()
        }
      },
      { upsert: true }
    );

    console.log('Repository metadata saved');
    return res.status(200).json({ success: true, message: 'Repo scanned successfully.' });
  } catch (err) {
    console.error('Error in /api/repo/scan:', err);
    return res.status(500).json({ success: false, message: 'Scan failed.', error: err.message });
  }
});


// GET /api/repo/list?userId=<userId>
router.get('/list', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing userId query parameter' });
    }

    const repos = await Repo.find({ userId });
    return res.status(200).json({ success: true, repos });
  } catch (err) {
    console.error('Error in /api/repo/list:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;