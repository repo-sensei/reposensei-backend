const NodeModel = require('../models/Node');
const path = require('path');
const fs = require('fs');

/**
 * Generate Cytoscape-compatible graph JSON using relatedComponents.
 * Omits nodes that have no edges (isolated nodes).
 */
async function generateCytoscapeGraph(repoId) {
  const nodes = await NodeModel.find({ repoId });

  // Top 30 by complexity
  const topNodes = nodes
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 30);

  const nodeMap = {};
  const elements = [];

  // Collect unique modules (folders) for compound nodes
  const moduleMap = new Map();

  for (const node of topNodes) {
    if (!moduleMap.has(node.module)) {
      const modId = `M_${node.module.replace(/[^a-zA-Z0-9]/g, '_')}`;
      moduleMap.set(node.module, modId);

      elements.push({
        data: { id: modId, label: node.module },
        classes: 'module', // style separately in frontend
      });
    }
  }

  // Map nodes with ids and assign parent module
  for (const [index, node] of topNodes.entries()) {
    const nodeId = `N${index}_${node.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    nodeMap[node.nodeId] = nodeId;

    const color =
      node.complexity >= 15 ? 'lightcoral' :
      node.complexity >= 8 ? 'gold' : 'lightgreen';

    const parentModuleId = moduleMap.get(node.module);

    elements.push({
      data: {
        id: nodeId,
        label: `${node.name} (C=${node.complexity})`,
        parent: parentModuleId,
        module: node.module,
        filePath: node.filePath,
        complexity: node.complexity,
        fileType: node.fileType,
        isAsync: node.isAsync,
        returnsValue: node.returnsValue,
        httpEndpoint: node.httpEndpoint,
        invokesAPI: node.invokesAPI,
        invokesDBQuery: node.invokesDBQuery,
        relatedComponents: node.relatedComponents,
        tooltip: `Lines: ${node.startLine}-${node.endLine}\nScope: ${node.scopeLevel}`,
      },
      // Correct CSS property key in kebab-case for Cytoscape
      style: { 'background-color': color },
    });
  }

  // Create edges based on relatedComponents
  const edges = [];
  for (const node of topNodes) {
    const fromId = nodeMap[node.nodeId];
    if (!fromId || !node.relatedComponents) continue;

    const fromModule = node.module;

    for (const relatedId of node.relatedComponents) {
      const relatedNode = topNodes.find(n => n.nodeId === relatedId);
      if (!relatedNode) continue;

      const toId = nodeMap[relatedId];
      if (!toId) continue;

      const toModule = relatedNode.module;
      const color = fromModule !== toModule ? 'red' : 'green';

      edges.push({
        data: {
          source: fromId,
          target: toId,
          color,
          relationship: fromModule !== toModule ? 'cross-module relation' : 'intra-module relation',
        },
        // Correct CSS property key in kebab-case for Cytoscape
        style: { 'line-color': color, width: 2 },
      });
    }
  }

  // Filter nodes only connected by edges
  const connectedNodeIds = new Set();
  edges.forEach(e => {
    connectedNodeIds.add(e.data.source);
    connectedNodeIds.add(e.data.target);
  });

  // Remove nodes that are not connected
  const finalElements = elements.filter(el => {
    if (el.data.id.startsWith('N')) {
      return connectedNodeIds.has(el.data.id);
    }
    // Keep all module (folder) nodes
    return true;
  });

  // Add edges after nodes
  finalElements.push(...edges);

  // Save to file
  const outDir = path.join(__dirname, '../../docs/generated');
  await fs.promises.mkdir(outDir, { recursive: true });
  const safeId = repoId.replace(/\W+/g, '_');
  const jsonPath = path.join(outDir, `${safeId}_cytograph.json`);
  await fs.promises.writeFile(jsonPath, JSON.stringify({ elements: finalElements }, null, 2));

  return jsonPath;
}

module.exports = { generateCytoscapeGraph };
