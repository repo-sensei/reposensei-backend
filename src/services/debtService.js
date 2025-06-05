const NodeModel = require('../models/Node');
const fs = require('fs');
const path = require('path');

// Scan for TODO/FIXME in source files
function detectTODOs(repoPath) {
  const todoMap = {};
  function traverseFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        traverseFiles(fullPath);
      } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (/\/\/\s*(TODO|FIXME)/.test(content)) {
          todoMap[fullPath] = true;
        }
      }
    }
  }
  traverseFiles(repoPath);
  return todoMap;
}

// Combine node complexity and TODO presence (and optionally coverage)
async function computeHotspots(repoId, repoPath) {
  const todoMap = detectTODOs(repoPath);
  const nodes = await NodeModel.find({ repoId });
  const hotspots = [];
  const coverageFile = path.join(repoPath, 'coverage', 'lcov.info');
  let coverageMap = {};
  if (fs.existsSync(coverageFile)) {
    const lcov = fs.readFileSync(coverageFile, 'utf-8').split('\n');
    let currentFile = '';
    lcov.forEach((line) => {
      if (line.startsWith('SF:')) {
        currentFile = line.substring(3);
      } else if (line.startsWith('LH:')) {
        const hits = parseInt(line.substring(3), 10);
        coverageMap[currentFile] = hits;
      }
    });
  }
  nodes.forEach((n) => {
    hotspots.push({
      nodeId: n.nodeId,
      filePath: n.filePath,
      complexity: n.complexity,
      hasTODO: !!todoMap[n.filePath],
      testCoverage: coverageMap[n.filePath] || null
    });
  });
  return hotspots;
}

module.exports = { detectTODOs, computeHotspots };
