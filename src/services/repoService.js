// src/services/repoService.js
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function getRepoStructure(repoId) {
  const repoPath = path.join(os.tmpdir(), 'reposensei', repoId);
  const structure = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        structure.push({
          module: path.relative(repoPath, full),
          desc: `Contains ${entry.name}`
        });
        await walk(full);
      }
    }
  }

  await walk(repoPath);
  return structure;
}

module.exports = { getRepoStructure };
