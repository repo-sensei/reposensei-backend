const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * Recursively collect all .js/.jsx/.ts/.tsx files under dir
 */
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

/**
 * Parse a single file and extract ALL function/class declarations (no import/export logic).
 * Complexity is computed by counting:
 *  - if/else (IfStatement)
 *  - loops: for, while, do…while, for…in, for…of
 *  - switch‐case (each 'case' with a test)
 *  - ternary expressions (ConditionalExpression)
 *  - logical && / || (LogicalExpression)
 *  - catch clauses (CatchClause)
 */
function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parse(content, {
    sourceType: 'unambiguous', // supports both ES modules and CommonJS
    plugins: ['typescript', 'jsx'],
  });

  const nodes = [];

  traverse(ast, {
    // 1) Named function declarations (function foo() { ... })
    FunctionDeclaration(pathNode) {
      const name = pathNode.node.id?.name;
      if (!name) return;

      const startLine = pathNode.node.loc.start.line;
      const endLine = pathNode.node.loc.end.line;

      // Compute complexity:
      let complexity = 1;
      pathNode.traverse({
        IfStatement() { complexity += 1; },
        ForStatement() { complexity += 1; },
        WhileStatement() { complexity += 1; },
        DoWhileStatement() { complexity += 1; },
        ForInStatement() { complexity += 1; },
        ForOfStatement() { complexity += 1; },
        SwitchCase(switchPath) {
          if (switchPath.node.test) complexity += 1;
        },
        ConditionalExpression() { complexity += 1; },
        LogicalExpression(logPath) {
          const op = logPath.node.operator;
          if (op === '&&' || op === '||') complexity += 1;
        },
        CatchClause() { complexity += 1; },
      });

      nodes.push({
        nodeId: `${filePath}::${name}`,
        filePath,
        startLine,
        endLine,
        type: 'function',
        name,
        complexity,
        calledFunctions: [],
      });
    },

    // 2) Arrow functions or function expressions assigned to a variable
    VariableDeclarator(pathNode) {
      const { id, init } = pathNode.node;
      if (
        (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') &&
        id.type === 'Identifier'
      ) {
        const name = id.name;
        const startLine = pathNode.node.loc.start.line;
        const endLine = pathNode.node.loc.end.line;

        let complexity = 1;
        pathNode.traverse({
          IfStatement() { complexity += 1; },
          ForStatement() { complexity += 1; },
          WhileStatement() { complexity += 1; },
          DoWhileStatement() { complexity += 1; },
          ForInStatement() { complexity += 1; },
          ForOfStatement() { complexity += 1; },
          SwitchCase(switchPath) {
            if (switchPath.node.test) complexity += 1;
          },
          ConditionalExpression() { complexity += 1; },
          LogicalExpression(logPath) {
            const op = logPath.node.operator;
            if (op === '&&' || op === '||') complexity += 1;
          },
          CatchClause() { complexity += 1; },
        });

        nodes.push({
          nodeId: `${filePath}::${name}`,
          filePath,
          startLine,
          endLine,
          type: 'function',
          name,
          complexity,
          calledFunctions: [],
        });
      }
    },

    // 3) Class declarations
    ClassDeclaration(pathNode) {
      const name = pathNode.node.id?.name;
      if (!name) return;

      const startLine = pathNode.node.loc.start.line;
      const endLine = pathNode.node.loc.end.line;

      let complexity = 1;
      pathNode.traverse({
        IfStatement() { complexity += 1; },
        ForStatement() { complexity += 1; },
        WhileStatement() { complexity += 1; },
        DoWhileStatement() { complexity += 1; },
        ForInStatement() { complexity += 1; },
        ForOfStatement() { complexity += 1; },
        SwitchCase(switchPath) {
          if (switchPath.node.test) complexity += 1;
        },
        ConditionalExpression() { complexity += 1; },
        LogicalExpression(logPath) {
          const op = logPath.node.operator;
          if (op === '&&' || op === '||') complexity += 1;
        },
        CatchClause() { complexity += 1; },
      });

      nodes.push({
        nodeId: `${filePath}::${name}`,
        filePath,
        startLine,
        endLine,
        type: 'class',
        name,
        complexity,
        calledFunctions: [],
      });
    },

    //4) Record function calls as dependencies,
    
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
