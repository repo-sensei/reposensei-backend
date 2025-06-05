const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Recursively collect all .js/.jsx/.ts/.tsx files under dir
function collectSourceFiles(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectSourceFiles(fullPath));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

// Parse a single file, extract function/class declarations
function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parse(content, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
  });

  const nodes = [];
  traverse(ast, {
    FunctionDeclaration(pathNode) {
      const name = pathNode.node.id?.name;
      if (!name) return;
      const startLine = pathNode.node.loc.start.line;
      const endLine = pathNode.node.loc.end.line;
      let complexity = 0;
      pathNode.traverse({
        IfStatement() {
          complexity += 1;
        }
      });
      nodes.push({
        nodeId: `${filePath}::${name}`,
        filePath,
        startLine,
        endLine,
        type: 'function',
        name,
        complexity,
        calledFunctions: []
      });
    },
    ClassDeclaration(pathNode) {
      const name = pathNode.node.id?.name;
      if (!name) return;
      const startLine = pathNode.node.loc.start.line;
      const endLine = pathNode.node.loc.end.line;
      let complexity = 0;
      pathNode.traverse({
        IfStatement() {
          complexity += 1;
        }
      });
      nodes.push({
        nodeId: `${filePath}::${name}`,
        filePath,
        startLine,
        endLine,
        type: 'class',
        name,
        complexity,
        calledFunctions: []
      });
    },
    CallExpression(pathNode) {
      const callee = pathNode.node.callee;
      if (callee.type === 'Identifier') {
        const fnName = callee.name;
        nodes.forEach(n => {
          if (n.name === fnName) {
            n.calledFunctions.push(`${n.filePath}::${fnName}`);
          }
        });
      }
    }
  });
  return nodes;
}

module.exports = { collectSourceFiles, parseFile };
