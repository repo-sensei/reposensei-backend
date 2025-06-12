const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const IGNORE_IMPORTS = new Set([
  'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
  'Fragment', 'React', 'createContext', 'useContext', 'useReducer',
  'Router', 'Route', 'Switch', 'Link', 'Navigate'
]);

const IGNORE_MODULES = new Set(['react', 'react-dom']);
const NEXT_DATA_FUNCS = new Set([
  'getStaticProps', 'getServerSideProps', 'getStaticPaths', 'getInitialProps'
]);

function computeComplexityBreakdown(pathNode) {
  const breakdown = {
    ifStatements: 0, loops: 0, switchCases: 0,
    ternaries: 0, logicalExpressions: 0, catchClauses: 0
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
    CatchClause() { breakdown.catchClauses++; }
  });
  breakdown.totalComplexity = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return breakdown;
}

function getParameters(node) {
  return (node.params || []).map(param => param.name || '');
}

function resolveImportToPath(baseFile, importPath) {
  if (!importPath.startsWith('.')) return null;
  const baseDir = path.dirname(baseFile);
  const absPath = path.resolve(baseDir, importPath);
  const exts = ['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.tsx'];
  for (const ext of exts) {
    const full = absPath + ext;
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function collectSourceFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(collectSourceFiles(fullPath));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function parseFile(filePath, repoId, moduleName) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parse(content, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });

  const fileFunctions = [];
  const exportedNames = new Set();
  const importsMap = new Map();

  // First pass to collect imports and exported names (named & default identifiers)
  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source.value;
      if (IGNORE_MODULES.has(src)) return;
      path.node.specifiers.forEach(spec => spec.local?.name && importsMap.set(spec.local.name, src));
    },
    ExportNamedDeclaration(path) {
      const d = path.node.declaration;
      if (d?.id?.name) exportedNames.add(d.id.name);
      else if (d?.declarations) d.declarations.forEach(dr => dr.id?.name && exportedNames.add(dr.id.name));
    },
    ExportDefaultDeclaration(path) {
      const d = path.node.declaration;
      if (d.type === 'Identifier') exportedNames.add(d.name);
    }
  });

  let currentNode = null;
  function pushNode(meta) {
    fileFunctions.push({
      repoId,
      nodeId: `${filePath}::${meta.name}`,
      filePath,
      module: moduleName,
      startLine: meta.loc.start.line,
      endLine: meta.loc.end.line,
      type: meta.type,
      name: meta.name,
      complexity: 0,
      complexityBreakdown: {},
      calledFunctions: [],
      calledBy: [],
      isExported: !!meta.isExported,
      parameters: meta.params || [],
      scopeLevel: meta.scopeLevel || 'top-level',
      isAsync: !!meta.isAsync,
      returnsValue: false,
      jsDocComment: '',
      fileType: inferFileType(filePath),
      httpEndpoint: '',
      invokesAPI: false,
      invokesDBQuery: false,
      relatedComponents: []
    });
    currentNode = fileFunctions[fileFunctions.length - 1];
  }
  function endNode() { currentNode = null; }

  function inferFileType(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/'); // Handle Windows paths

    if (/\/(pages|routes|components|frontend)\//.test(normalizedPath)) return 'frontend';
    if (/\/(api|server|backend|controllers|routes)\//.test(normalizedPath)) return 'backend';
    if (/\/(utils|helpers|lib|common)\//.test(normalizedPath)) return 'util';
    if (/\/(test|__tests__)\//.test(normalizedPath) || /\.test\.(js|ts|jsx|tsx)$/.test(normalizedPath)) return 'test';
    
    return 'shared';
  }


  // Your onCall and onJSX functions from before
  function onCall(path) {
    const callee = path.node.callee;
    if (callee.type === 'Identifier' && currentNode) {
      const fn = callee.name;
      if (!IGNORE_IMPORTS.has(fn) && (!importsMap.has(fn) || !IGNORE_MODULES.has(importsMap.get(fn)))) {
        let target = fn;
        if (importsMap.has(fn)) {
          const src = importsMap.get(fn);
          const rp = resolveImportToPath(filePath, src);
          if (rp) target = `${rp}::${fn}`;
          if (/axios|fetch/.test(fn)) currentNode.invokesAPI = true;
          if (/prisma|mongoose|db/.test(src)) currentNode.invokesDBQuery = true;
        }
        currentNode.calledFunctions.push(target);
      }
    }
  }

  function onJSX(path) {
    const nm = path.node.name.name;
    const src = importsMap.get(nm);
    if (!IGNORE_IMPORTS.has(nm) && src && !IGNORE_MODULES.has(src) && currentNode) {
      const rp = resolveImportToPath(filePath, src);
      if (rp) currentNode.relatedComponents.push(`${rp}::${nm}`);
    }
  }

  // Main AST traversal for function, variable, class, class methods
  traverse(ast, {
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (!name || (!exportedNames.has(name) && !NEXT_DATA_FUNCS.has(name))) return;
      const type = NEXT_DATA_FUNCS.has(name) ? 'next-data' : 'function';
      pushNode({
        name,
        type,
        loc: path.node.loc,
        isExported: exportedNames.has(name),
        params: getParameters(path.node),
        scopeLevel: 'top-level',
        isAsync: path.node.async
      });
      currentNode.complexityBreakdown = computeComplexityBreakdown(path);
      currentNode.complexity = currentNode.complexityBreakdown.totalComplexity;
      path.traverse({ CallExpression: onCall, JSXOpeningElement: onJSX });
      currentNode.returnsValue = !!path.node.body.body.find(stmt => stmt.type === 'ReturnStatement' && stmt.argument);
      endNode();
    },
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (id.type === 'Identifier' && init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(init.type)
          && exportedNames.has(id.name)) {
        pushNode({
          name: id.name,
          type: 'function',
          loc: path.node.loc,
          isExported: true,
          params: getParameters(init),
          scopeLevel: 'top-level',
          isAsync: init.async
        });
        currentNode.complexityBreakdown = computeComplexityBreakdown(path.get('init'));
        currentNode.complexity = currentNode.complexityBreakdown.totalComplexity;
        path.traverse({ CallExpression: onCall, JSXOpeningElement: onJSX });
        currentNode.returnsValue = !!(init.body && init.body.type === 'BlockStatement' && init.body.body.find(stmt => stmt.type === 'ReturnStatement' && stmt.argument));
        endNode();
      }

      // For GraphQL resolvers object pattern
      if (id.name === 'resolvers' && init?.type === 'ObjectExpression') {
        init.properties.forEach(container => {
          if (container.value.type === 'ObjectExpression') {
            const cont = container.key.name;
            container.value.properties.forEach(fnProp => {
              const fnName = fnProp.key.name;
              const fnNode = fnProp.value;
              if (['FunctionExpression', 'ArrowFunctionExpression'].includes(fnNode.type)) {
                pushNode({
                  name: `${cont}.${fnName}`,
                  type: 'graphql-resolver',
                  loc: fnNode.loc,
                  isExported: true,
                  params: getParameters(fnNode),
                  scopeLevel: 'top-level',
                  isAsync: fnNode.async
                });
                currentNode.complexityBreakdown = computeComplexityBreakdown(path.get('init'));
                currentNode.complexity = currentNode.complexityBreakdown.totalComplexity;
                fnProp.traverse({ CallExpression: onCall, JSXOpeningElement: onJSX });
                endNode();
              }
            });
          }
        });
      }
    },
    ClassDeclaration(path) {
      const name = path.node.id?.name;
      if (!name || !exportedNames.has(name)) return;
      pushNode({ name, type: 'class', loc: path.node.loc, isExported: true });
      endNode();
    },
    ClassMethod(path) {
      const method = path.node.key.name;
      const parent = path.parentPath.node.id?.name;
      pushNode({
        name: method,
        type: 'method',
        loc: path.node.loc,
        isExported: false,
        parentName: parent,
        params: getParameters(path.node),
        scopeLevel: 'class-method',
        isAsync: path.node.async
      });
      currentNode.complexityBreakdown = computeComplexityBreakdown(path);
      currentNode.complexity = currentNode.complexityBreakdown.totalComplexity;
      path.traverse({ CallExpression: onCall, JSXOpeningElement: onJSX });
      endNode();
    },

    // <== NEW: ExportDefaultDeclaration handler with full logic
    ExportDefaultDeclaration(path) {
      const decl = path.node.declaration;

      if (decl.type === 'FunctionDeclaration') {
        // Named or anonymous default exported function
        const name = decl.id ? decl.id.name : 'default';
        pushNode({
          name,
          type: 'function',
          loc: decl.loc,
          isExported: true,
          params: getParameters(decl),
          scopeLevel: 'top-level',
          isAsync: decl.async,
        });
        currentNode.complexityBreakdown = computeComplexityBreakdown(path.get('declaration'));
        currentNode.complexity = currentNode.complexityBreakdown.totalComplexity;
        path.traverse({ CallExpression: onCall, JSXOpeningElement: onJSX });
        endNode();
      }
      else if (decl.type === 'ClassDeclaration') {
        const name = decl.id ? decl.id.name : 'default';
        pushNode({
          name,
          type: 'class',
          loc: decl.loc,
          isExported: true,
        });
        endNode();
      }
      else if (decl.type === 'Identifier') {
        // Just track the name for now; could be handled later by VariableDeclarator or FunctionDeclaration
        exportedNames.add(decl.name);
      }
      else if (decl.type === 'ArrowFunctionExpression' || decl.type === 'FunctionExpression') {
        // e.g., export default () => {}
        pushNode({
          name: 'default',
          type: 'function',
          loc: decl.loc,
          isExported: true,
          params: getParameters(decl),
          scopeLevel: 'top-level',
          isAsync: decl.async,
        });
        currentNode.complexityBreakdown = computeComplexityBreakdown(path.get('declaration'));
        currentNode.complexity = currentNode.complexityBreakdown.totalComplexity;
        path.traverse({ CallExpression: onCall, JSXOpeningElement: onJSX });
        endNode();
      }
      else {
        // Other export default cases can be handled here if needed
      }
    }
  });

  // Another pass to capture calls to router.<method> with handler refs
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type === 'MemberExpression' && callee.object.name === 'router') {
        const [, handler] = path.node.arguments;
        if (handler?.type === 'Identifier' && currentNode) {
          const src = importsMap.get(handler.name);
          if (IGNORE_MODULES.has(src)) return;
          const target = src ? `${resolveImportToPath(filePath, src)}::${handler.name}` : handler.name;
          currentNode.calledFunctions.push(target);
          currentNode.httpEndpoint = `${callee.property.name.toUpperCase()} ${path.node.arguments[0]?.value || ''}`;
        }
      }
    }
  });

  // Build reverse call links
  const mapById = new Map(fileFunctions.map(n => [n.nodeId, n]));
  fileFunctions.forEach(n => {
    n.calledFunctions.forEach(c => {
      if (mapById.has(c)) mapById.get(c).calledBy.push(n.nodeId);
    });
  });

  return fileFunctions;
}

module.exports = { collectSourceFiles, parseFile };