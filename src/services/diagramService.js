const NodeModel = require('../models/Node');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/**
 * Build a DOT graph clustered by module, styled by complexity, and rendered to SVG.
 */
async function generateDotGraph(repoId) {
  const nodes = await NodeModel.find({ repoId });

  // Take top 30 nodes by complexity
  const topNodes = nodes
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 30);

  // Map nodeId -> DOT-safe name
  const idMap = {};
  topNodes.forEach((n, i) => {
    const label = n.name.replace(/[^a-zA-Z0-9]/g, '_');
    idMap[n.nodeId] = `N${i}_${label}`;
  });

  // Start building DOT graph
  let dot = `
digraph G {
  rankdir=LR;              // left-to-right layout
  splines=ortho;           // orthogonal edges for clarity
  nodesep=0.8;             // more space between nodes horizontally
  ranksep=1.0;             // more space between ranks vertically
  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10];
  edge [arrowsize=0.7, penwidth=1.2];
  
  // Legend node for edge colors
  subgraph cluster_legend {
    label="Legend";
    style=filled;
    color=white;
    node [shape=note, fontsize=9, style=filled, fillcolor=white];
    legend_green [label="Green: Intra-Module Calls"];
    legend_red [label="Red: Cross-Module Calls"];
  }
`;

  // Group nodes by module or directory fallback
  const groups = {};
  topNodes.forEach(n => {
    const groupKey = n.module || path.dirname(n.filePath) || '.';
    groups[groupKey] = groups[groupKey] || [];
    groups[groupKey].push(n);
  });

  // Add clustered nodes by module
  Object.entries(groups).forEach(([mod, ns], gi) => {
    dot += `  subgraph cluster_${gi} {\n`;
    dot += `    label = "${mod}";\n`;
    dot += `    style=filled; color="#f0f0f0"; node [style=filled,color=white];\n`;

    ns.forEach(n => {
      const nid = idMap[n.nodeId];
      if (!nid) return;

      // Color nodes by complexity
      let fill = 'lightgreen';
      if (n.complexity >= 15) fill = 'lightcoral';
      else if (n.complexity >= 8) fill = 'gold';

      const safeLabel = n.name.replace(/"/g, '\\"');
      dot += `    ${nid} [label="${safeLabel}\\n(C=${n.complexity})", fillcolor="${fill}"];\n`;
    });

    dot += `  }\n\n`;
  });

  // Add edges with color coding for module calls
  topNodes.forEach(n => {
    const from = idMap[n.nodeId];
    if (!from || !n.calledFunctions) return;

    const fromModule = n.module || path.dirname(n.filePath) || '.';

    n.calledFunctions.forEach(cf => {
      const to = idMap[cf];
      if (!to) return;

      const callee = topNodes.find(x => x.nodeId === cf);
      const toModule = callee?.module || path.dirname(callee?.filePath || '') || '.';

      // Color edges red if cross-module, green if same-module
      const edgeColor = (fromModule !== toModule) ? 'red' : 'green';

      dot += `  ${from} -> ${to} [color="${edgeColor}"];\n`;
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
