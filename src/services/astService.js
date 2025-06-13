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

function getModuleName(filePath) {
  const parts = filePath.split(path.sep);
  const fileName = path.basename(filePath, path.extname(filePath));
  
  // Find relevant directory context
  const relevantDirs = ['controllers', 'models', 'services', 'routes', 'middleware', 'components', 'pages', 'utils', 'lib', 'api'];
  const dirIndex = parts.findIndex(part => relevantDirs.includes(part));
  
  if (dirIndex !== -1) {
    return `${parts[dirIndex]}/${fileName}`;
  }
  
  // Fallback to last directory + filename
  return parts.length > 1 ? `${parts[parts.length - 2]}/${fileName}` : fileName;
}

function collectSourceFiles(dir) {
  let files = [];
  console.log(`Collecting files from: ${dir}`);
  
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip common ignore directories
      if (!['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) {
        files = files.concat(collectSourceFiles(fullPath));
      }
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  
  console.log(`Found ${files.length} source files in ${dir}`);
  return files;
}

function inferFileType(filePath, content = '') {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  
  // Check directory patterns first
  if (/\/(pages|components|frontend|client|ui)\//.test(normalizedPath)) return 'frontend';
  if (/\/(api|server|backend|controllers|routes|services|models|middleware)\//.test(normalizedPath)) return 'backend';
  if (/\/(utils|helpers|lib|common|shared)\//.test(normalizedPath)) return 'util';
  if (/\/(test|_tests_|spec)\//.test(normalizedPath) || /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(normalizedPath)) return 'test';
  
  // Check file content for backend patterns
  if (content.includes('express') || content.includes('app.get') || content.includes('app.post') || 
      content.includes('router.') || content.includes('mongoose') || content.includes('prisma') ||
      content.includes('sequelize') || content.includes('knex') || content.includes('req.') || 
      content.includes('res.')) return 'backend';
  
  // Check for frontend patterns
  if (content.includes('React') || content.includes('useState') || content.includes('useEffect') ||
      content.includes('jsx') || content.includes('<div') || content.includes('Component')) return 'frontend';
  
  return 'shared';
}

function parseFile(filePath, repoId, providedModuleName = null) {
  console.log(`Parsing file: ${filePath}`);
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileType = inferFileType(filePath, content);
  
  // Generate a more specific module name
  const moduleName = providedModuleName || getModuleName(filePath);
  
  let ast;
  try {
    ast = parser.parse(content, { 
      sourceType: 'unambiguous', 
      plugins: ['typescript', 'jsx'] 
    });
  } catch (error) {
    console.error(`Failed to parse ${filePath}:`, error.message);
    return [];
  }

  const fileFunctions = [];
  const exportedNames = new Set();
  const importsMap = new Map();

  // First pass to collect imports and exported names
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
      fileName: path.basename(filePath, path.extname(filePath)),
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
      fileType: fileType,
      httpEndpoint: '',
      invokesAPI: false,
      invokesDBQuery: false,
      relatedComponents: []
    });
    currentNode = fileFunctions[fileFunctions.length - 1];
  }
  
  function endNode() { 
    currentNode = null; 
  }

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

  // Function to determine if we should process a function based on file type
  function shouldProcessFunction(name, isExported, fileType) {
    // For backend files, process ALL functions (exported or not)
    if (fileType === 'backend') return true;
    
    // For frontend files, only process exported functions or Next.js data functions
    if (fileType === 'frontend') {
      return isExported || NEXT_DATA_FUNCS.has(name);
    }
    
    // For other files, process exported functions
    return isExported;
  }

  // Main AST traversal
  traverse(ast, {
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (!name) return;
      
      const isExported = exportedNames.has(name);
      if (!shouldProcessFunction(name, isExported, fileType)) return;
      
      const type = NEXT_DATA_FUNCS.has(name) ? 'next-data' : 'function';
      pushNode({
        name,
        type,
        loc: path.node.loc,
        isExported,
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
      if (id.type === 'Identifier' && init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(init.type)) {
        const isExported = exportedNames.has(id.name);
        if (!shouldProcessFunction(id.name, isExported, fileType)) return;
        
        pushNode({
          name: id.name,
          type: 'function',
          loc: path.node.loc,
          isExported,
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

      // GraphQL resolvers object pattern
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
      if (!name) return;
      
      const isExported = exportedNames.has(name);
      if (!shouldProcessFunction(name, isExported, fileType)) return;
      
      pushNode({ 
        name, 
        type: 'class', 
        loc: path.node.loc, 
        isExported 
      });
      endNode();
    },
    
    ClassMethod(path) {
      const method = path.node.key.name;
      const parent = path.parentPath.node.id?.name;
      
      // Always process class methods if we're processing the parent class
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

    ExportDefaultDeclaration(path) {
      const decl = path.node.declaration;

      if (decl.type === 'FunctionDeclaration') {
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
        exportedNames.add(decl.name);
      }
      else if (decl.type === 'ArrowFunctionExpression' || decl.type === 'FunctionExpression') {
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
    }
  });

  // Capture router calls and HTTP endpoints
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

  console.log(`Extracted ${fileFunctions.length} functions from ${filePath} (${fileType}) as module: ${moduleName}`);
  return fileFunctions;
}

module.exports = { collectSourceFiles, parseFile };