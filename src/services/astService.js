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

// Parse a single file, extract function/class declarations, imports, and dependencies
function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parse(content, {
    sourceType: 'unambiguous', // allows both ES modules and CommonJS
    plugins: ['typescript', 'jsx']
  });

  const nodes = [];
  const exportedNames = new Set();

  // Map local imported name => source file path (string as written, needs resolving later)
  const importsMap = new Map();

  // Track dependencies by used imported names found in JSX or calls
  const usedImports = new Set();

  // First pass: collect export names & imports
  traverse(ast, {
    ImportDeclaration(pathNode) {
      const source = pathNode.node.source.value; // e.g. './Footer'
      for (const specifier of pathNode.node.specifiers) {
        if (
          specifier.type === 'ImportDefaultSpecifier' ||
          specifier.type === 'ImportSpecifier' ||
          specifier.type === 'ImportNamespaceSpecifier'
        ) {
          const localName = specifier.local.name;
          importsMap.set(localName, source);
        }
      }
    },

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
      if (decl.type === 'Identifier') {
        exportedNames.add(decl.name); // e.g., export default Foo;
      } else {
        const name = decl.id?.name || 'default';
        const startLine = decl.loc?.start.line ?? 0;
        const endLine = decl.loc?.end.line ?? 0;
        const type = decl.type === 'ClassDeclaration' ? 'class' : 'function';
        nodes.push({
          nodeId: `${filePath}::${name}`,
          filePath,
          startLine,
          endLine,
          type,
          name,
          complexity: 0,
          calledFunctions: []
        });
      }
    }
  });

  // Handle late export default identifier
  for (const stmt of ast.program.body) {
    if (
      stmt.type === 'ExportDefaultDeclaration' &&
      stmt.declaration.type === 'Identifier'
    ) {
      exportedNames.add(stmt.declaration.name);
    }
  }

  traverse(ast, {
    AssignmentExpression(pathNode) {
      const left = pathNode.node.left;
      if (
        left.type === 'MemberExpression' &&
        left.object.type === 'Identifier' &&
        (left.object.name === 'module' || left.object.name === 'exports')
      ) {
        // module.exports = something OR exports.foo = something
        if (
          left.object.name === 'module' &&
          left.property.type === 'Identifier' &&
          left.property.name === 'exports'
        ) {
          // module.exports = ...
          // Try to get exported names if possible
          const right = pathNode.node.right;
          if (right.type === 'Identifier') {
            exportedNames.add(right.name);
          } else if (right.type === 'ObjectExpression') {
            for (const prop of right.properties) {
              if (prop.key && prop.key.type === 'Identifier') {
                exportedNames.add(prop.key.name);
              }
            }
          }
        } else if (left.object.name === 'exports' && left.property.type === 'Identifier') {
          // exports.foo = ...
          exportedNames.add(left.property.name);
        }
      }
    },

    // 4. Detect CommonJS require imports: const foo = require('module')
    VariableDeclarator(pathNode) {
      const { id, init } = pathNode.node;
      if (
        init?.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        init.arguments.length === 1 &&
        init.arguments[0].type === 'StringLiteral' &&
        id.type === 'Identifier'
      ) {
        const localName = id.name;
        const source = init.arguments[0].value;
        importsMap.set(localName, source);
      }
    }
  });
  // Second pass: extract functions/classes/calls and detect JSX usage
  traverse(ast, {
    VariableDeclarator(pathNode) {
      const { id, init } = pathNode.node;
      if (
        (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') &&
        id?.type === 'Identifier' &&
        exportedNames.has(id.name)
      ) {
        const name = id.name;
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
      }
    },

    FunctionDeclaration(pathNode) {
      const name = pathNode.node.id?.name;
      if (!name || !exportedNames.has(name)) return;
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
      if (!name || !exportedNames.has(name)) return;
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
        // If callee is an imported function, mark used import
        if (importsMap.has(fnName)) {
          usedImports.add(fnName);
        }
      }
    },

    JSXOpeningElement(pathNode) {
      const nameNode = pathNode.node.name;
      if (nameNode.type === 'JSXIdentifier') {
        const componentName = nameNode.name;
        // Check if this JSX element corresponds to an imported component
        if (importsMap.has(componentName)) {
          usedImports.add(componentName);
        }
      }
    }
  });

  // After traversal, add used imports as calledFunctions dependencies
  for (const usedImportName of usedImports) {
    const importedSource = importsMap.get(usedImportName);
    // Represent dependency as imported module with the imported component name
    nodes.forEach(n => {
      // Add dependency to every node in this file for simplicity; you can refine to specific nodes if you want
      n.calledFunctions.push(`${importedSource}::${usedImportName}`);
    });
  }

  return nodes;
}

module.exports = { collectSourceFiles, parseFile };
