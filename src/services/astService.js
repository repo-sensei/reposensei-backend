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

function parseFile(filePath, repoId, moduleName) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parse(content, {
    sourceType: 'unambiguous', // allows both ES modules and CommonJS
    plugins: ['typescript', 'jsx']
  });

  const nodes = [];
  const exportedNames = new Set();
  const importsMap = new Map();
  const usedImports = new Set();

  // Helper: compute complexity breakdown
  function computeComplexityBreakdown(pathNode) {
    const breakdown = {
      ifStatements: 0,
      loops: 0,
      switchCases: 0,
      ternaries: 0,
      logicalExpressions: 0,
      catchClauses: 0,
    };
    pathNode.traverse({
      IfStatement() { breakdown.ifStatements++; },
      ForStatement() { breakdown.loops++; },
      WhileStatement() { breakdown.loops++; },
      DoWhileStatement() { breakdown.loops++; },
      ForInStatement() { breakdown.loops++; },
      ForOfStatement() { breakdown.loops++; },
      SwitchCase() { breakdown.switchCases++; },
      ConditionalExpression() { breakdown.ternaries++; },
      LogicalExpression() { breakdown.logicalExpressions++; },
      CatchClause() { breakdown.catchClauses++; },
    });
    const totalComplexity = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { breakdown, totalComplexity };
  }

  // Helper: get function parameters as array of string names
  function getParameters(node) {
    if (!node.params) return [];
    return node.params.map(param => {
      if (param.type === 'Identifier') return param.name;
      // For complex param types, fallback to empty string
      return '';
    });
  }

  // First pass: collect exported names and imports
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
        exportedNames.add(decl.name);
      } else {
        // Handled below in second pass
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

  // Handle CommonJS exports and requires
  traverse(ast, {
    AssignmentExpression(pathNode) {
      const left = pathNode.node.left;
      if (
        left.type === 'MemberExpression' &&
        left.object.type === 'Identifier' &&
        (left.object.name === 'module' || left.object.name === 'exports')
      ) {
        if (
          left.object.name === 'module' &&
          left.property.type === 'Identifier' &&
          left.property.name === 'exports'
        ) {
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
          exportedNames.add(left.property.name);
        }
      }
    },

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

  // Second pass: collect nodes for functions, classes, and methods
  traverse(ast, {
    FunctionDeclaration(pathNode) {
      const node = pathNode.node;
      const name = node.id?.name;
      if (!name || !exportedNames.has(name)) return;
      const { breakdown, totalComplexity } = computeComplexityBreakdown(pathNode);
      const params = getParameters(node);
      nodes.push({
        repoId,
        nodeId: `${filePath}::${name}`,
        filePath,
        module: moduleName,
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        type: 'function',
        name,
        complexity: totalComplexity,
        complexityBreakdown: breakdown,
        calledFunctions: [],
        calledBy: [],
        isExported: true,
        parentName: null,
        parameters: params,
        scopeLevel: 'top-level',
        isAsync: !!node.async,
      });
    },

    VariableDeclarator(pathNode) {
      const { id, init } = pathNode.node;
      if (
        (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') &&
        id?.type === 'Identifier' &&
        exportedNames.has(id.name)
      ) {
        const { breakdown, totalComplexity } = computeComplexityBreakdown(pathNode);
        const params = getParameters(init);
        nodes.push({
          repoId,
          nodeId: `${filePath}::${id.name}`,
          filePath,
          module: moduleName,
          startLine: pathNode.node.loc.start.line,
          endLine: pathNode.node.loc.end.line,
          type: 'function',
          name: id.name,
          complexity: totalComplexity,
          complexityBreakdown: breakdown,
          calledFunctions: [],
          calledBy: [],
          isExported: true,
          parentName: null,
          parameters: params,
          scopeLevel: 'top-level',
          isAsync: !!init.async,
        });
      }
    },

    ClassDeclaration(pathNode) {
      const node = pathNode.node;
      const name = node.id?.name;
      if (!name || !exportedNames.has(name)) return;
      const { breakdown, totalComplexity } = computeComplexityBreakdown(pathNode);
      nodes.push({
        repoId,
        nodeId: `${filePath}::${name}`,
        filePath,
        module: moduleName,
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        type: 'class',
        name,
        complexity: totalComplexity,
        complexityBreakdown: breakdown,
        calledFunctions: [],
        calledBy: [],
        isExported: true,
        parentName: null,
        parameters: [],
        scopeLevel: 'top-level',
        isAsync: false,
      });
    },

    ClassMethod(pathNode) {
      const node = pathNode.node;
      const name = node.key?.name;
      if (!name) return;
      const parentClass = pathNode.parentPath?.node?.id?.name || null;
      const { breakdown, totalComplexity } = computeComplexityBreakdown(pathNode);
      const params = getParameters(node);
      nodes.push({
        repoId,
        nodeId: `${filePath}::${parentClass}::${name}`,
        filePath,
        module: moduleName,
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        type: 'method',
        name,
        complexity: totalComplexity,
        complexityBreakdown: breakdown,
        calledFunctions: [],
        calledBy: [],
        isExported: false,
        parentName: parentClass,
        parameters: params,
        scopeLevel: 'class-method',
        isAsync: !!node.async,
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
        if (importsMap.has(fnName)) {
          usedImports.add(fnName);
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

  // Add used imports as calledFunctions dependencies to all nodes in this file
  for (const usedImportName of usedImports) {
    const importedSource = importsMap.get(usedImportName);
    nodes.forEach(n => {
      n.calledFunctions.push(`${importedSource}::${usedImportName}`);
    });
  }

  return nodes;
}

module.exports = { collectSourceFiles, parseFile };
