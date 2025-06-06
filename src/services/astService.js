const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

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

function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parse(content, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx']
  });

  const nodes = [];
  const exportedNames = new Set();
  const declaredFunctions = new Map(); // name -> pathNode
  const importsMap = new Map(); // local name -> source path
  const usedImports = new Set();

  // === First pass: Imports + Declarations ===
  traverse(ast, {
    ImportDeclaration(pathNode) {
      const source = pathNode.node.source.value;
      pathNode.node.specifiers.forEach(spec => {
        if (spec.local?.name) importsMap.set(spec.local.name, source);
      });
    },

    VariableDeclarator(pathNode) {
      const { id, init } = pathNode.node;

      // CommonJS require() import
      if (
        init?.type === 'CallExpression' &&
        init.callee.name === 'require' &&
        init.arguments.length === 1 &&
        init.arguments[0].type === 'StringLiteral'
      ) {
        const source = init.arguments[0].value;
        if (id.type === 'Identifier') {
          importsMap.set(id.name, source);
        } else if (id.type === 'ObjectPattern') {
          for (const prop of id.properties) {
            if (prop.key.type === 'Identifier') {
              importsMap.set(prop.key.name, source);
            }
          }
        }
      }

      // Capture arrow or function expressions
      if (
        (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') &&
        id?.type === 'Identifier'
      ) {
        declaredFunctions.set(id.name, pathNode);
      }
    },

    FunctionDeclaration(pathNode) {
      const name = pathNode.node.id?.name;
      if (name) declaredFunctions.set(name, pathNode);
    },

    ClassDeclaration(pathNode) {
      const name = pathNode.node.id?.name;
      if (name) declaredFunctions.set(name, pathNode);
    }
  });

  // === Second pass: Handle Exports ===
  traverse(ast, {
    ExportNamedDeclaration(pathNode) {
      const decl = pathNode.node.declaration;
      if (decl?.type === 'FunctionDeclaration' && decl.id?.name) {
        exportedNames.add(decl.id.name);
      } else if (decl?.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (d.id?.name) exportedNames.add(d.id.name);
        }
      }
    },

    ExportDefaultDeclaration(pathNode) {
      const decl = pathNode.node.declaration;
      const name = decl?.id?.name || 'default_export';
      const startLine = decl.loc?.start.line ?? 0;
      const endLine = decl.loc?.end.line ?? 0;

      nodes.push({
        nodeId: `${filePath}::${name}`,
        filePath,
        startLine,
        endLine,
        type: decl.type === 'ClassDeclaration' ? 'class' : 'function',
        name,
        complexity: 0,
        calledFunctions: []
      });
    },

    AssignmentExpression(pathNode) {
      const { node } = pathNode;
      const left = node.left;
      const right = node.right;

      if (
        left.type === 'MemberExpression' &&
        left.object.name === 'module' &&
        left.property.name === 'exports'
      ) {
        if (right.type === 'FunctionExpression' || right.type === 'ArrowFunctionExpression') {
          nodes.push({
            nodeId: `${filePath}::default_export`,
            filePath,
            startLine: right.loc?.start.line ?? 0,
            endLine: right.loc?.end.line ?? 0,
            type: 'function',
            name: 'default_export',
            complexity: 0,
            calledFunctions: []
          });
        } else if (right.type === 'ObjectExpression') {
          for (const prop of right.properties) {
            if (prop.key.type === 'Identifier') {
              exportedNames.add(prop.key.name);
            }
          }
        }
      }

      // exports.foo = function() {}
      if (
        left.type === 'MemberExpression' &&
        left.object.name === 'exports' &&
        left.property.type === 'Identifier'
      ) {
        const fnName = left.property.name;
        exportedNames.add(fnName);

        if (right.type === 'FunctionExpression' || right.type === 'ArrowFunctionExpression') {
          nodes.push({
            nodeId: `${filePath}::${fnName}`,
            filePath,
            startLine: right.loc?.start.line ?? 0,
            endLine: right.loc?.end.line ?? 0,
            type: 'function',
            name: fnName,
            complexity: 0,
            calledFunctions: []
          });
        }
      }
    }
  });

  // === Third pass: Declared + Exported Functions ===
  for (const [name, pathNode] of declaredFunctions.entries()) {
    if (!exportedNames.has(name)) continue;

    const node = pathNode.node;
    const type =
      node.type === 'FunctionDeclaration' ? 'function' :
      node.init?.type === 'ClassExpression' ? 'class' : 'function';

    const bodyNode = node.body || node.init?.body;
    const startLine = node.loc?.start.line ?? 0;
    const endLine = node.loc?.end.line ?? 0;
    let complexity = 0;

    pathNode.traverse({
      IfStatement() { complexity += 1; },
      ForStatement() { complexity += 1; },
      WhileStatement() { complexity += 1; },
      SwitchStatement() { complexity += 1; },
      TryStatement() { complexity += 1; }
    });

    nodes.push({
      nodeId: `${filePath}::${name}`,
      filePath,
      startLine,
      endLine,
      type,
      name,
      complexity,
      calledFunctions: []
    });
  }

  // === Final pass: Track function calls and JSX usage ===
  traverse(ast, {
    CallExpression(pathNode) {
      const callee = pathNode.node.callee;

      if (callee.type === 'Identifier') {
        const fnName = callee.name;
        if (importsMap.has(fnName)) usedImports.add(fnName);

        for (const n of nodes) {
          if (n.name !== fnName) continue;
          n.calledFunctions.push(`${filePath}::${fnName}`);
        }
      } else if (callee.type === 'MemberExpression') {
        const object = callee.object;
        const property = callee.property;

        if (
          (object.type === 'Identifier' && ['module', 'exports'].includes(object.name)) &&
          property.type === 'Identifier'
        ) {
          const fnName = property.name;
          for (const n of nodes) {
            if (n.name !== fnName) continue;
            n.calledFunctions.push(`${filePath}::${fnName}`);
          }
        }

        if (object.type === 'Identifier' && importsMap.has(object.name)) {
          usedImports.add(object.name);
        }
      }
    },

    JSXOpeningElement(pathNode) {
      const nameNode = pathNode.node.name;
      if (nameNode.type === 'JSXIdentifier') {
        const componentName = nameNode.name;
        if (importsMap.has(componentName)) {
          usedImports.add(componentName);
        }
      }
    }
  });

  // === Link imported used functions ===
  for (const used of usedImports) {
    const source = importsMap.get(used);
    for (const n of nodes) {
      n.calledFunctions.push(`${source}::${used}`);
    }
  }

  return nodes;
}

module.exports = {
  collectSourceFiles,
  parseFile
};