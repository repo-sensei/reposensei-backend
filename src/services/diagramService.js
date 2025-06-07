// src/services/diagramService.js

const NodeModel = require('../models/Node');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/**
 * 1) Build a DOT graph (.dot) clustering by directory and styling by complexity.
 * 2) Render it to SVG via the `dot` CLI.
 */
async function generateDotGraph(repoId) {
  const nodes = await NodeModel.find({ repoId });

  // Take top 30 by complexity
  const topNodes = nodes
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 30);

  // Map nodeId -> DOT-safe name
  const idMap = {};
  topNodes.forEach((n, i) => {
    const label = n.name.replace(/[^a-zA-Z0-9]/g, '_');
    idMap[n.nodeId] = `N${i}_${label}`;
  });

  // Start building DOT
  let dot = `
digraph G {
  rankdir=LR;            // left-to-right
  splines=ortho;         // orthogonal edges
  nodesep=0.6;           // horizontal separation
  ranksep=0.8;           // vertical separation
  node [shape=box, style="rounded,filled", fontname="Helvetica"];
  edge [arrowsize=0.6];
`;

  // Cluster by directory
  const groups = {};
  topNodes.forEach(n => {
    const dir = path.dirname(n.filePath) || '.';
    groups[dir] = groups[dir] || [];
    groups[dir].push(n);
  });

  Object.entries(groups).forEach(([dir, ns], gi) => {
    dot += `  subgraph cluster_${gi} {\n`;
    dot += `    label = "${dir}";\n`;
    dot += `    style=filled; color=lightgrey; node [style=filled,color=white];\n`;
    ns.forEach(n => {
      const nid = idMap[n.nodeId];
      // Color based on complexity
      let fill = 'white';
      if (n.complexity >= 15) fill = 'lightcoral';
      else if (n.complexity >= 8) fill = 'gold';
      else fill = 'lightgreen';

      const safeLabel = n.name.replace(/"/g, '\\"');
      dot += `    ${nid} [label="${safeLabel}\\n(C=${n.complexity})", fillcolor="${fill}"];\n`;
    });
    dot += `  }\n\n`;
  });

  // Edges among top nodes
  topNodes.forEach(n => {
    const from = idMap[n.nodeId];
    n.calledFunctions.forEach(cf => {
      const to = idMap[cf];
      if (to) {
        dot += `  ${from} -> ${to};\n`;
      }
    });
  });

  dot += `}\n`;

  // Write .dot file
  const outDir = path.join(__dirname, '../../docs/generated');
  await fs.promises.mkdir(outDir, { recursive: true });
  const safeId = repoId.replace(/\W+/g, '_');
  const dotFile = path.join(outDir, `${safeId}_graph.dot`);
  await fs.promises.writeFile(dotFile, dot);
  return dotFile;
}

/**
 * Render a .dot file to SVG using Graphviz's dot command.
 */
async function renderDotToSvg(dotFile) {
  const svgFile = dotFile.replace(/\.dot$/, '.svg');
  await new Promise((resolve, reject) => {
    exec(`dot -Tsvg "${dotFile}" -o "${svgFile}"`, (err, stdout, stderr) => {
      if (err) {
        console.error('Graphviz error:', stderr);
        return reject(err);
      }
      resolve();
    });
  });
  return svgFile;
}

module.exports = { generateDotGraph, renderDotToSvg };
