const NodeModel = require('../models/Node');
const path = require('path');
const fs = require('fs');

async function generateCytoscapeGraph(repoId) {
  const nodes = await NodeModel.find({ repoId });

  const topNodes = nodes
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 30);

  const nodeMap = {};
  const elements = [];

  const moduleMap = new Map();

  for (const node of topNodes) {
    if (!moduleMap.has(node.module)) {
      const modId = `M_${node.module.replace(/[^a-zA-Z0-9]/g, '_')}`;
      moduleMap.set(node.module, modId);

      elements.push({
        data: { id: modId, label: node.module },
        classes: 'module',
      });
    }
  }

  // Define modern dark theme complexity colors
  const getNodeColor = (complexity) => {
    if (complexity >= 15) return '#EF4444'; // soft red
    if (complexity >= 8) return '#F59E0B';  // soft orange
    return '#10B981'; // soft green
  };

  for (const [index, node] of topNodes.entries()) {
    const nodeId = `N${index}_${node.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    nodeMap[node.nodeId] = nodeId;

    const color = getNodeColor(node.complexity);
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
      style: {
        'background-color': '#1F2937',        // dark gray base
        'border-color': color,                // accent border based on complexity
        'border-width': 2,
        'text-outline-color': '#111827',
        'text-outline-width': 1,
        color: '#F3F4F6',
      },
    });
  }

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

      const isCrossModule = fromModule !== relatedNode.module;

      edges.push({
        data: {
          source: fromId,
          target: toId,
          relationship: isCrossModule ? 'cross-module' : 'intra-module',
        },
        style: {
          'line-color': '#6B7280',               // neutral gray
          'target-arrow-color': '#6B7280',
          'target-arrow-shape': 'triangle',
          'line-style': 'dotted',
          width: 1.5,
        },
      });
    }
  }

  const connectedNodeIds = new Set();
  edges.forEach(e => {
    connectedNodeIds.add(e.data.source);
    connectedNodeIds.add(e.data.target);
  });

  const finalElements = elements.filter(el => {
    if (el.data.id.startsWith('N')) {
      return connectedNodeIds.has(el.data.id);
    }
    return true;
  });

  finalElements.push(...edges);

  const outDir = path.join(__dirname, '../../docs/generated');
  await fs.promises.mkdir(outDir, { recursive: true });
  const safeId = repoId.replace(/\W+/g, '_');
  const jsonPath = path.join(outDir, `${safeId}_cytograph.json`);
  await fs.promises.writeFile(jsonPath, JSON.stringify({ elements: finalElements }, null, 2));

  return jsonPath;
}

module.exports = { generateCytoscapeGraph };
