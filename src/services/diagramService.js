const NodeModel = require('../models/Node');
const path = require('path');
const fs = require('fs');

async function generateCytoscapeGraph(repoId) {
    const nodes = await NodeModel.find({ repoId });
    
    // Top 30 by complexity
    const topNodes = nodes
      .sort((a, b) => b.complexity - a.complexity)
    
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
          classes: 'module',
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
          calledFunctions: node.calledFunctions, // Include this for backend relationships
          tooltip: `Lines: ${node.startLine}-${node.endLine}\nScope: ${node.scopeLevel}`,
        },
        style: { 'background-color': color },
      });
    }
    
    // Create edges based on BOTH relatedComponents AND calledFunctions
    const edges = [];
    const connectedNodeIds = new Set();
    
    for (const node of topNodes) {
      const fromId = nodeMap[node.nodeId];
      if (!fromId) continue;
      
      const fromModule = node.module;
      
      // Handle frontend component relationships (relatedComponents)
      if (node.relatedComponents && node.relatedComponents.length > 0) {
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
              relationship: fromModule !== toModule ? 'cross-module component' : 'intra-module component',
            },
            style: { 'line-color': color, width: 2 },
          });
          
          connectedNodeIds.add(fromId);
          connectedNodeIds.add(toId);
        }
      }
      
      // Handle backend function call relationships (calledFunctions)
      if (node.calledFunctions && node.calledFunctions.length > 0) {
        for (const calledId of node.calledFunctions) {
          // Find the called function in our top nodes
          const calledNode = topNodes.find(n => n.nodeId === calledId);
          if (!calledNode) continue;
          
          const toId = nodeMap[calledId];
          if (!toId) continue;
          
          const toModule = calledNode.module;
          const color = fromModule !== toModule ? 'blue' : 'purple';
          
          edges.push({
            data: {
              source: fromId,
              target: toId,
              color,
              relationship: fromModule !== toModule ? 'cross-module call' : 'intra-module call',
            },
            style: { 'line-color': color, width: 2 },
          });
          
          connectedNodeIds.add(fromId);
          connectedNodeIds.add(toId);
        }
      }
    }
    
    // For backend nodes that might not have connections, show them anyway if they're important
    // (high complexity or are endpoints)
    for (const node of topNodes) {
      const nodeId = nodeMap[node.nodeId];
      if (nodeId && (node.fileType === 'backend' && (node.complexity >= 5 || node.httpEndpoint))) {
        connectedNodeIds.add(nodeId);
      }
    }
    
    // Filter nodes - keep connected nodes OR important backend nodes
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