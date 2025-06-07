const path = require('path');
const fs = require('fs');
const axios = require('axios');
const NodeModel = require('../models/Node'); 
const HotspotSnapshotModel = require('../models/HotspotSnapshot');

const WEIGHTS = {
  complexity: 0.5,
  todo: 1.0,
  coverage: 0.3,
  age: 0.2
};

function detectTODOs(repoPath) {
  const todoData = {};
  function traverse(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return traverse(full);
      if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) return;

      const content = fs.readFileSync(full, 'utf-8');
      const lines = content.split('\n');
      let count = 0;
      let severityCount = { critical: 0, high: 0, medium: 0, low: 0 };
      lines.forEach(line => {
        const match = line.match(/\/\/\s*(TODO|FIXME)\s*(?:\(([^)]+)\))?\s*:\s*(.*)/);
        if (match) {
          count++;
          const tag = match[2] || 'medium';
          const sev = ['critical','high','medium','low'].includes(tag.toLowerCase()) ? tag.toLowerCase() : 'medium';
          severityCount[sev]++;
        }
      });
      if (count) todoData[full] = { count, severityCount };
    });
  }
  traverse(repoPath);
  return todoData;
}

async function computeHotspots(repoId, repoPath) {
  const todoMap = detectTODOs(repoPath);
  const nodes = await NodeModel.find({ repoId }).lean();
  const now = Date.now();

  const maxComplexity = Math.max(...nodes.map(n => Number(n.complexity) || 0), 1);

  // Load coverage data
  const coverageFile = path.join(repoPath, 'coverage', 'lcov.info');
  const coverageMap = {};
  if (fs.existsSync(coverageFile)) {
    let currentFile = '';
    fs.readFileSync(coverageFile, 'utf-8').split('\n').forEach(line => {
      if (line.startsWith('SF:')) currentFile = path.resolve(repoPath, line.slice(3).trim());
      else if (line.startsWith('LH:')) coverageMap[currentFile] = parseInt(line.slice(3), 10);
    });
  }
  const maxCoverage = Math.max(...Object.values(coverageMap).map(v => Number(v) || 0), 1);

  // Prepare hotspot data WITHOUT LLM calls
  let hotspots = nodes.map(n => {
    const absFilePath = path.resolve(repoPath, n.filePath);
    const todoInfo = todoMap[absFilePath] || { count: 0, severityCount: {} };
    const hits = Number(coverageMap[absFilePath]) || 0;

    const updatedAt = new Date(n.updatedAt);
    const createdAt = new Date(n.createdAt);
    const lastModified = !isNaN(updatedAt) ? updatedAt : (!isNaN(createdAt) ? createdAt : new Date());
    const ageDays = (now - lastModified.getTime()) / (1000 * 60 * 60 * 24);

    const complexity = Number(n.complexity) || 0;
    const normComplex = complexity / maxComplexity;
    const normCoverage = (maxCoverage - hits) / maxCoverage;
    const ageFactor = isNaN(ageDays) ? 0 : ageDays / 365;

    let score =
      WEIGHTS.complexity * normComplex +
      WEIGHTS.todo * (Number(todoInfo.count) || 0) +
      WEIGHTS.coverage * normCoverage +
      WEIGHTS.age * ageFactor;

    if (isNaN(score)) score = 0;

    return {
      ...n,
      absFilePath,
      todoCount: todoInfo.count,
      severity: todoInfo.severityCount,
      coverageHits: hits,
      lastModified: lastModified.toISOString(),
      debtScore: score,
      // Note: no refactorSuggestions here
    };
  });

  // Sort by debtScore descending
  hotspots.sort((a, b) => b.debtScore - a.debtScore);

  // Keep only top 5 hotspots
  hotspots = hotspots.slice(0, 5);

  // Save snapshot (top 5)
  try {
    await HotspotSnapshotModel.create({
      repoId,
      timestamp: new Date(),
      hotspots: hotspots
    });
  } catch (err) {
    console.error('Error saving HotspotSnapshot:', err);
  }

  return hotspots; // returns top 5 hotspots WITHOUT suggestions
}

// Helper function to safely get code snippet (can be reused)
function getSnippet(filePath, startLine, endLine) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found for snippet: ${filePath}`);
      return '';
    }
    const content = fs.readFileSync(filePath, 'utf-8').split('\n');
    const start = Math.max(0, (startLine || 1) - 1);
    const end = Math.min(content.length, endLine || start + 10);
    return content.slice(start, end).join('\n');
  } catch (err) {
    console.error('Error reading snippet:', err);
    return '';
  }
}

// New function to fetch refactor suggestions for a specific nodeId on demand
async function fetchRefactorSuggestions(nodeId, repoPath) {
  const node = await NodeModel.findOne({ nodeId }).lean();
  if (!node) {
    throw new Error('Node not found');
  }

  const absFilePath = path.resolve(repoPath, node.filePath);
  const snippet = getSnippet(absFilePath, node.startLine, node.endLine);
  if (!snippet) {
    return 'No snippet available';
  }

  const promptAI = `Explain why this function is complex and suggest two refactorings in 200 words only:\n\n${snippet}`;

  try {
    const res = await axios.post(
      `${process.env.PYTHON_BACKEND_URL}/analyze`,
      { prompt: promptAI }
    );
    return res.data.suggestions || 'No suggestions returned';
  } catch (err) {
    console.error(`LLM analyze failed for node ${nodeId}:`, err.message);
    return 'Failed to get suggestions due to error';
  }
}

module.exports = { detectTODOs, computeHotspots, fetchRefactorSuggestions };
