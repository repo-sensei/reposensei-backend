const { callLLM } = require('./llmService');
const { getRepoStructure } = require('./repoService');
const supabase = require('../config/supabase');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { ESLint } = require('eslint');

// Role-to-directory mappings
const roleDirs = {
  frontend: ['components', 'pages', 'styles'],
  backend: ['controllers', 'models', 'middleware', 'services']
};
const FLOWS = new Map(); 
const normalizePath = (p) => p.replace(/\\/g, '/');

// Start the onboarding flow
async function startFlow(userId, repoId) {
  const step0 = {
    stepId: 'choose-role',
    prompt: 'Welcome! Do you want to focus on frontend or backend?',
    options: ['frontend', 'backend']
  };
  const flow = { userId, repoId, role: null, history: [step0] };
  FLOWS.set(userId, flow);
  await supabase.from('onboarding_sessions').upsert({
    user_id: userId,
    repo_id: repoId,
    flow
  });
  return step0;
}

// Handle the next step in the flow
async function nextStep(userId, input) {
  let flow = FLOWS.get(userId);
  if (!flow) {
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select('flow')
      .eq('user_id', userId)
      .single();
    if (error || !data) throw new Error('No onboarding session found');
    flow = data.flow;
    FLOWS.set(userId, flow);
  }

  const repoPath = path.join(os.tmpdir(), 'reposensei', flow.repoId);
  const last = flow.history[flow.history.length - 1];

  if (last.stepId === 'choose-role') {
    if (last.stepId === 'choose-role') {
  const role = input.trim().toLowerCase();
  if (!['frontend', 'backend'].includes(role)) {
    throw new Error('Invalid role selected');
  }
  flow.role = role;

  let structure;
  const { data: cached } = await supabase
    .from('repo_structures')
    .select('structure')
    .eq('repo_id', flow.repoId)
    .single();
  if (cached) {
    structure = cached.structure;
  } else {
    structure = await getRepoStructure(flow.repoId);
    await supabase.from('repo_structures').insert({ repo_id: flow.repoId, structure });
  }

const relevantModules = structure.filter((s) =>
  roleDirs[role].some((dir) => normalizePath(s.module).toLowerCase().includes(`/${dir.toLowerCase()}`))
);

  const step1 = {
    stepId: 'show-overview-and-tasks',
    overviewId: null,
    tasks: []
  };

  flow.history.push(step1);
  await supabase
    .from('onboarding_sessions')
    .upsert({ user_id: userId, repo_id: flow.repoId, flow });

  return step1;
}
  }

  if (last.stepId === 'show-overview-and-tasks') {
    return {
      message: 'You’ve completed onboarding!',
      next: null
    };
  }

  throw new Error(`Unknown stepId: ${last.stepId}`);
}


async function generateDetailedOverview(modules, repoPath, role) {
  let html = `
<html><head><title>${role} Overview</title></head><body>
<h1>${role.charAt(0).toUpperCase() + role.slice(1)} Overview</h1>
<p>This section provides a concise breakdown of the ${role} modules.</p>
`;

  const allowedExtensions = ['.js', '.jsx', '.ts', '.tsx'];
  const maxFilesPerModule = 8;

  for (const module of modules) {
    html += `<h2>${module.module}</h2><p>${module.desc}</p><ul>`;
    const allFiles = await fs.readdir(path.join(repoPath, module.module));
    const targetFiles = allFiles
      .filter(f => allowedExtensions.includes(path.extname(f)))
      .slice(0, maxFilesPerModule);

    for (const file of targetFiles) {
      const filePath = path.join(repoPath, module.module, file);
      const content = await fs.readFile(filePath, 'utf-8');

      if (content.length < 600) continue; // Skip trivial files

      // Extract first function block (for context)
      const functionRegex = /(const|let|var)?\s*\w+\s*=\s*(async\s*)?\(?[\w\s,]*\)?\s*=>\s*{[\s\S]*?}|function\s+\w+\s*\([^)]*\)\s*{[\s\S]*?}/g;

      const block = (content.match(functionRegex) || [])[0];

      const context = block ? `Here is a key function from the file:\n\n${block}` : '';
      const prompt = `You are helping onboard a ${role} developer.\nExplain the purpose and role of the file "${file}" inside "${module.module}" module based on its content.\n${context}\n\nKeep it concise and useful for onboarding.`;

      const summary =  "None" //await callLLM(prompt);

      html += `
<li><strong>${file}</strong>
<p>${summary}</p>
}
</li>`;
    }

    html += '</ul>';
  }

  html += '</body></html>';
  return html;
}



// Helper to detect frontend based on path or file type
function isFrontendModule(modulePath) {
  return modulePath.includes('client') || modulePath.includes('components') || modulePath.includes('jsx');
}

// Returns ESLint instance based on type
function getESLintInstance(isFrontend) {
  return new ESLint({
    cwd: process.cwd(),
    useEslintrc: false,
    overrideConfig: isFrontend
      ? {
          extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:jsx-a11y/recommended'],
          parserOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            ecmaFeatures: { jsx: true },
          },
          plugins: ['react', 'jsx-a11y'],
          settings: {
            react: { version: 'detect' },
          },
          env: {
            browser: true,
            node: true,
            es6: true,
          },
        }
      : {
          extends: ['eslint:recommended'],
          parserOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
          },
          env: {
            node: true,
            es6: true,
          },
        },
  });
}

// Main task generator
async function generateCriticalTasks(modules, repoPath) {
  const tasks = [];

  for (const module of modules) {
    const normalizedModulePath = path.normalize(module.module);
    const dirPath = path.join(repoPath, normalizedModulePath);
    const isFrontend = isFrontendModule(normalizedModulePath);
    const eslint = getESLintInstance(isFrontend);

    const MAX_FILES_PER_MODULE = 2;

    try {
      const files = await fs.readdir(dirPath);
      const filePaths = files
        .filter((f) => f.endsWith('.js') || f.endsWith('.jsx'))
        .slice(0, MAX_FILES_PER_MODULE)
        .map((f) => path.join(dirPath, f));

      if (filePaths.length === 0) continue;

   

      const results = await eslint.lintFiles(filePaths);

      const MAX_TOTAL_ISSUES = 10;
let issueCount = 0;

for (const fileResult of results) {
  if (issueCount >= MAX_TOTAL_ISSUES) break;

  for (const issue of fileResult.messages.slice(0, 5)) {
    if (issueCount >= MAX_TOTAL_ISSUES) break;
   

    const prompt = `Rephrase lint issue into an actionable task in short: "${issue.message}" in ${fileResult.filePath}:${issue.line}`;
    //const desc = await callLLM(prompt);
    tasks.push({
      title: `Fix ${path.basename(fileResult.filePath)}`,
      description: "None",
      file: fileResult.filePath,
      line: issue.line,
      severity: issue.severity,
    });
    issueCount++;
  }
}

    } catch (err) {
      console.warn('Failed to lint files in:', dirPath, err.message);
    }
  }

  return tasks;
}

async function generateOverview(userId, repoId) {
 const { data: sessionData, error } = await supabase
  .from('onboarding_sessions')
  .select('flow')
  .eq('user_id', userId)
  .eq('repo_id', repoId)
  .single()
    
  if (error || !sessionData) {
    throw new Error('Session not founddddd');
  }

  const flow = sessionData.flow;
  const role = flow.role;
  const repoPath = path.join(os.tmpdir(), 'reposensei', repoId);

  const structure = await getRepoStructure(repoId);
  const relevantModules = structure.filter((s) =>
    roleDirs[role].some((dir) =>
      normalizePath(s.module).toLowerCase().includes(`/${dir.toLowerCase()}`)
    )
  );

  const overviewHtml = await generateDetailedOverview(relevantModules, repoPath, role);

  const { data: ovData, error: insertError } = await supabase
    .from('onboarding_overviews')
    .insert({
      user_id: userId,
      repo_id: repoId,
      role,
      html: overviewHtml
    })
    .select('id')
    .single();

  if (insertError) {
    throw new Error('Failed to save overview');
  }

  flow.history = flow.history.map((step) =>
    step.stepId === 'show-overview-and-tasks'
      ? { ...step, overviewId: ovData.id }
      : step
  );

  await supabase
    .from('onboarding_sessions')
    .upsert({ user_id: userId, repo_id: repoId, flow });

  FLOWS.set(userId, flow);

  return ovData.id;
}


async function generateTasks(userId, repoId) {
  const { data: sessionData, error } = await supabase
    .from('onboarding_sessions')
    .select('flow')
    .eq('user_id', userId)
    .eq('repo_id', repoId)
    .single()

  if (error || !sessionData) {
    throw new Error('Session not found');
  }

  const flow = sessionData.flow;
  const role = flow.role;
  const repoPath = path.join(os.tmpdir(), 'reposensei', repoId);

  const structure = await getRepoStructure(repoId);
  const relevantModules = structure.filter((s) =>
    roleDirs[role].some((dir) =>
      normalizePath(s.module).toLowerCase().includes(`/${dir.toLowerCase()}`)
    )
  );

  const criticalTasks = await generateCriticalTasks(relevantModules, repoPath);

  flow.history = flow.history.map((step) =>
    step.stepId === 'show-overview-and-tasks'
      ? { ...step, tasks: criticalTasks }
      : step
  );

  await supabase
    .from('onboarding_sessions')
    .upsert({ user_id: userId, repo_id: repoId, flow });
    
  FLOWS.set(userId, flow);

  return true;
}


module.exports = {
  startFlow,
  nextStep,
  generateOverview,
  generateTasks
};
