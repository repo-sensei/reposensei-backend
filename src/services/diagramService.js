const NodeModel = require('../models/Node');
const path = require('path');
const fs = require('fs');

async function generateCytoscapeGraph(repoId) {
  // Load all nodes for this repo
  const nodes = await NodeModel.find({ repoId });

  const nodeMap = {}; // node.nodeId → cytoscape ID
  const nodeIdToNode = {};
  const moduleMap = new Map(); // module name → compound ID
  const connectedNodeIds = new Set();
  const edges = [];

  // Build ID map first
  nodes.forEach((node, idx) => {
    const cyId = `N${idx}_${node.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    nodeMap[node.nodeId] = cyId;
    nodeIdToNode[node.nodeId] = node;
  });

  // Build edges and mark connected node IDs
  for (const node of nodes) {
    const sourceId = nodeMap[node.nodeId];
    const fromMod = node.module;

    for (const targetId of node.relatedComponents || []) {
      const targetCyId = nodeMap[targetId];
      if (!targetCyId) continue;

      const toMod = nodeIdToNode[targetId].module;
      const color = fromMod !== toMod ? '#1B2027' : '#CAF5BB';

      edges.push({
        data: {
          source: sourceId,
          target: targetCyId,
          relationship: fromMod !== toMod ? 'cross-module component' : 'intra-module component'
        },
        style: { 'line-color': color, width: 2 }
      });

      connectedNodeIds.add(sourceId);
      connectedNodeIds.add(targetCyId);
    }

    for (const targetId of node.calledFunctions || []) {
      const targetCyId = nodeMap[targetId];
      if (!targetCyId) continue;

      const toMod = nodeIdToNode[targetId].module;
      const color = fromMod !== toMod ? '#1B2027' : '#2F89FF';

      edges.push({
        data: {
          source: sourceId,
          target: targetCyId,
          relationship: fromMod !== toMod ? 'cross-module call' : 'intra-module call'
        },
        style: { 'line-color': color, width: 1.5 }
      });

      connectedNodeIds.add(sourceId);
      connectedNodeIds.add(targetCyId);
    }
  }

  // Now build node elements only for connected ones
  const elements = [];

  for (const node of nodes) {
    const cyId = nodeMap[node.nodeId];
    if (!connectedNodeIds.has(cyId)) continue;

    // Create module compound node if needed
    if (!moduleMap.has(node.module)) {
      const modId = `M_${node.module.replace(/[^a-zA-Z0-9]/g, '_')}`;
      moduleMap.set(node.module, modId);

      elements.push({
        data: { id: modId, label: node.module },
        classes: 'module'
      });
    }

    elements.push({
      data: {
        id: cyId,
        label: `${node.name} (C=${node.complexity})`,
        parent: moduleMap.get(node.module),
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
        calledFunctions: node.calledFunctions
      },
      style: {
        'background-color':
          node.complexity >= 15 ? '#1B2027' : // Deep purple
          node.complexity >= 8 ? '#2F89FF' :  // Teal
          '#2F89FF',                          // Soft blue
        'border-width':0
      }
    });
  }

  // Finalize graph
  elements.push(...edges);

  // Write to JSON
  const outDir = path.join(__dirname, '../../docs/generated');
  await fs.promises.mkdir(outDir, { recursive: true });
  const safeId = repoId.replace(/\W+/g, '_');
  const jsonPath = path.join(outDir, `${safeId}_cytograph.json`);
  await fs.promises.writeFile(jsonPath, JSON.stringify({ elements }, null, 2));

  return jsonPath;
}

module.exports = { generateCytoscapeGraph };
