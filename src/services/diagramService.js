const NodeModel = require('../models/Node');
const path = require('path');
const fs = require('fs');

async function generateCytoscapeGraph(repoId) {
  //Load all nodes for this repo
  const nodes = await NodeModel.find({ repoId });

  //Prepare mappings and element arrays
  const nodeMap = {};           // maps node.nodeId → Cytoscape ID
  const elements = [];
  const moduleMap = new Map();  // maps module name → compound node ID

  //First, emit one compound node per module/folder
  for (const node of nodes) {
    if (!moduleMap.has(node.module)) {
      const modId = `M_${node.module.replace(/[^a-zA-Z0-9]/g, '_')}`;
      moduleMap.set(node.module, modId);
      elements.push({
        data: { id: modId, label: node.module },
        classes: 'module'
      });
    }
  }

  //Then, emit a node for every function in every file
  nodes.forEach((node, idx) => {
    const cyId = `N${idx}_${node.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    nodeMap[node.nodeId] = cyId;

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
          node.complexity >= 15 ? '#7C3AED' : // Deep purple for very complex
          node.complexity >= 8 ? '#06B6D4' :  // Teal for moderate
          '#60A5FA',                          // Soft blue for less complex
        'border-width': 1
      }
    });
  });

  //Now build edges for every relationship
  const edges = [];

  nodes.forEach(node => {
    const sourceId = nodeMap[node.nodeId];
    const fromMod = node.module;

    //Component relationships
    (node.relatedComponents || []).forEach(targetNodeId => {
      const target = nodeMap[targetNodeId];
      if (!target) return;
      const toMod = nodes.find(n => n.nodeId === targetNodeId).module;
      const color = fromMod !== toMod ? '#F472B6' : '#34D399'; // Pink for cross-module, green for intra-module

      edges.push({
        data: {
          source: sourceId,
          target,
          relationship: fromMod !== toMod
            ? 'cross-module component'
            : 'intra-module component'
        },
        style: { 'line-color': color, width: 2 }
      });
    });

    //Function-call relationships
    (node.calledFunctions || []).forEach(targetNodeId => {
      const target = nodeMap[targetNodeId];
      if (!target) return;
      const toMod = nodes.find(n => n.nodeId === targetNodeId).module;
      const color = fromMod !== toMod ? '#A78BFA' : '#38BDF8'; // Light purple for cross-module, sky blue for intra-module

      edges.push({
        data: {
          source: sourceId,
          target,
          relationship: fromMod !== toMod
            ? 'cross-module call'
            : 'intra-module call'
        },
        style: { 'line-color': color, width: 1.5 }
      });
    });
  });

  //Merge nodes + edges and write out the JSON
  elements.push(...edges);

  const outDir = path.join(__dirname, '../../docs/generated');
  await fs.promises.mkdir(outDir, { recursive: true });
  const safeId = repoId.replace(/\W+/g, '_');
  const jsonPath = path.join(outDir, `${safeId}_cytograph.json`);
  await fs.promises.writeFile(jsonPath, JSON.stringify({ elements }, null, 2));

  return jsonPath;
}

module.exports = { generateCytoscapeGraph };
