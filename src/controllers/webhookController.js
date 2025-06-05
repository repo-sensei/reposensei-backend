// src/controllers/webhookController.js

const express = require('express');
const Repo = require('../models/Repo');
const CommitModel = require('../models/Commit');
const NodeModel = require('../models/Node');
const fs = require('fs');
const path = require('path');
const {
  cloneRepo,
  getCommitHistory
} = require('../services/gitService');
const { upsertCodeEmbedding } = require('../services/vectorService');
const { collectSourceFiles, parseFile } = require('../services/astService');
const { summarizeChanges } = require('../services/changeService');
const { generateMermaidGraph, renderMermaidToSvg } = require('../services/diagramService');

const router = express.Router();

router.post('/github', async (req, res) => {
  try {
    const payload = req.body;
    const repoFullName = payload.repository.full_name; // e.g. "org/repo"
    const repoRec = await Repo.findOne({ repoUrl: new RegExp(repoFullName) });
    if (!repoRec) {
      return res.status(404).send('Repo not registered.');
    }

    const repoPath = path.join(require('os').tmpdir(), 'reposensei', repoRec.repoId);
    // 1) Re-clone (or pull) the latest changes
    //   If repoPath already exists, do `git pull` instead of re-clone.
    if (fs.existsSync(repoPath)) {
      // If cloned previously, do a pull
      const simpleGit = require('simple-git')(repoPath);
      await simpleGit.pull();
    } else {
      // first time: clone
      await cloneRepo(repoRec.repoUrl, repoRec.repoId);
    }

    // 2) Fetch all commits from the repo directory
    const allCommits = await getCommitHistory(repoPath);
    // Filter only the new ones (those not in Mongo Commits)
    const existingShas = (
      await CommitModel.find({ repoId: repoRec.repoId }).select('sha')
    ).map((c) => c.sha);

    const newCommits = allCommits.filter((c) => !existingShas.includes(c.sha));

    // 3) Insert each new commit into Mongo + embed its message
    for (const c of newCommits) {
      await CommitModel.create({
        repoId: repoRec.repoId,
        sha: c.sha,
        message: c.message,
        author: c.author,
        date: new Date(c.date)
      });
      await upsertCodeEmbedding(
        repoRec.repoId,
        'commit',
        c.sha,
        c.message,
        { author: c.author, date: c.date }
      );
    }

    // 4) Determine which files changed in this push event
    //    GitHub webhook payload includes `payload.head_commit.modified` (array of paths).
    //    We can also inspect `payload.head_commit.added` and `payload.head_commit.removed`.
    const head = payload.head_commit;
    const modifiedFiles = head.modified || [];
    const addedFiles = head.added || [];
    const removedFiles = head.removed || [];

    // 5) For each removed file, delete all NodeModel docs whose filePath matches
    for (const removedPath of removedFiles) {
      const absoluteRemoved = path.join(repoPath, removedPath);
      await NodeModel.deleteMany({ filePath: absoluteRemoved });
      // Also remove embeddings for nodes in that file from Supabase
      await supabase
        .from('code_embeddings')
        .delete()
        .eq('repo_id', repoRec.repoId)
        .eq('type', 'node')
        .like('metadata->>filePath', `%${removedPath}%`);
    }

    // 6) For each newly added or modified file, re‐parse it
    const affectedFiles = [...new Set([...addedFiles, ...modifiedFiles])];
    for (const relPath of affectedFiles) {
      const absPath = path.join(repoPath, relPath);
      if (!fs.existsSync(absPath)) continue; // safety

      // a) Delete any existing NodeModel entries for that file
      await NodeModel.deleteMany({ filePath: absPath });
      // b) Also delete their embeddings in Supabase
      await supabase
        .from('code_embeddings')
        .delete()
        .eq('repo_id', repoRec.repoId)
        .eq('type', 'node')
        .like('metadata->>filePath', `%${relPath}%`);

      // c) Parse the file to extract functions/classes
      const nodes = parseFile(absPath);
      for (const node of nodes) {
        await NodeModel.create({
          repoId: repoRec.repoId,
          nodeId: node.nodeId,
          filePath: node.filePath,
          startLine: node.startLine,
          endLine: node.endLine,
          type: node.type,
          name: node.name,
          complexity: node.complexity,
          calledFunctions: node.calledFunctions
        });
        // d) Embed the code snippet for this function
        const fileContent = fs.readFileSync(absPath, 'utf-8');
        const snippet = fileContent
          .split('\n')
          .slice(node.startLine - 1, node.endLine)
          .join('\n');

        await upsertCodeEmbedding(
          repoRec.repoId,
          'node',
          node.nodeId,
          snippet,
          { filePath: relPath }
        );
      }
    }

    // 7) Summarize changes via LLM (optional)
    const summary = await summarizeChanges(
      repoRec.repoId,
      new Date(repoRec.lastScanned)
    );

    // 8) Re-generate architecture diagram
    const mmdFile = await generateMermaidGraph(repoRec.repoId);
    const svgFile = await renderMermaidToSvg(mmdFile);

    // 9) Update lastScanned time
    repoRec.lastScanned = new Date();
    await repoRec.save();

    // 10) Optionally write summary + SVG to disk
    const outDir = path.join(__dirname, '../../docs/generated');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `${repoRec.repoId}-changes.txt`),
      summary
    );
    // (SVG was already created by renderMermaidToSvg)

    return res.status(200).send('Webhook processed and DB updated.');
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).send('Error processing webhook');
  }
});

module.exports = router;
