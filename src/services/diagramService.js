const NodeModel = require('../models/Node');
const fs = require('fs');
const path = require('path');
const exec = require('child_process').exec;

// Generate Mermaid flowchart code for top‐N complex nodes
async function generateMermaidGraph(repoId) {
  const nodes = await NodeModel.find({ repoId });
  // Take top 30 by complexity
  const topNodes = nodes.sort((a, b) => b.complexity - a.complexity).slice(0, 30);

  let mermaidCode = 'graph LR\n';
  topNodes.forEach((n) => {
    const nodeLabel = n.name.replace(/[^a-zA-Z0-9]/g, '_');
    mermaidCode += `  ${nodeLabel}["${n.name} (C:${n.complexity})"]\n`;
    n.calledFunctions.forEach((cf) => {
      const calledName = cf.split('::')[1];
      const calledLabel = calledName.replace(/[^a-zA-Z0-9]/g, '_');
      mermaidCode += `  ${nodeLabel} --> ${calledLabel}\n`;
    });
  });

  try {
    const outDir = path.join(__dirname, '../../docs/generated');
    await fs.promises.mkdir(outDir, { recursive: true });
    const safeRepoId = repoId.replace(/\//g, '_');
    const mmdFile = path.join(outDir, `${safeRepoId}-graph.mmd`);
    await fs.promises.writeFile(mmdFile, mermaidCode);
    return mmdFile;
  } catch (error) {
    console.error('Error saving Mermaid file:', error);
    throw error;
  }
}

// Convert Mermaid .mmd to SVG using mermaid‐cli (install globally or as dep)
async function renderMermaidToSvg(mermaidFile) {
  const svgFile = mermaidFile.replace('.mmd', '.svg');
  await new Promise((resolve, reject) => {
    exec(`mmdc -i ${mermaidFile} -o ${svgFile}`, (error, stdout, stderr) => {
      if (error) {
        console.error('Mermaid render error:', stderr);
        return reject(error);
      }
      resolve();
    });
  });
  return svgFile;
}

module.exports = { generateMermaidGraph, renderMermaidToSvg };
