const { callLLM } = require('./llmService');
const { getRepoStructure } = require('./repoService');
const supabase = require('../config/supabase');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { ESLint } = require('eslint');

// Role-to-directory mappings
const roleDirs = {
  frontend: ['src/components', 'src/pages', 'src/styles'],
  backend: ['src/controllers', 'src/models', 'src/middleware', 'src/services']
};

const FLOWS = new Map();

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
    roleDirs[role].some((dir) => s.module.startsWith(dir))
  );

  const overviewHtml = await generateDetailedOverview(relevantModules, repoPath, role);

  const { data: ovData } = await supabase
    .from('onboarding_overviews')
    .insert({
      user_id: userId,
      repo_id: flow.repoId,
      role,
      html: overviewHtml
    })
    .select('id')
    .single();

  const criticalTasks = await generateCriticalTasks(relevantModules, repoPath);

  const step1 = {
    stepId: 'show-overview-and-tasks',
    overviewId: ovData.id,
    tasks: criticalTasks
  };

  flow.history.push(step1);
  await supabase
    .from('onboarding_sessions')
    .upsert({ user_id: userId, repo_id: flow.repoId, flow });

  return step1;
}


    return step1;
  }

  if (last.stepId === 'show-overview-and-tasks') {
    return {
      message: 'You’ve completed onboarding!',
      next: null
    };
  }

  throw new Error(`Unknown stepId: ${last.stepId}`);
}


// Generate a detailed HTML overview
async function generateDetailedOverview(modules, repoPath, role) {
  let html = `
<html><head><title>${role} Overview</title></head><body>
<h1>${role.charAt(0).toUpperCase() + role.slice(1)} Overview</h1>
<p>This section provides a detailed breakdown of the ${role} modules.</p>
`;

  for (const module of modules) {
    html += `<h2>${module.module}</h2><p>${module.desc}</p><ul>`;
    const files = await fs.readdir(path.join(repoPath, module.module));
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const filePath = path.join(repoPath, module.module, file);
      const content = await fs.readFile(filePath, 'utf-8');

      // 1) Purpose explanation
      const purposePrompt = `Explain the purpose and role of ${file} in ${module.module} for a ${role} developer in detail.`;
      const purpose = await callLLM(purposePrompt);

      // 2) Extract first 3 function blocks
      const functionRegex = /function\\s+\\w+\\s*\\([^)]*\\)\\s*{[\\s\\S]*?}/g;
      const blocks = content.match(functionRegex) || [];
      let blocksHtml = '';
      for (const block of blocks.slice(0, 5)) {
        const explanationPrompt = `Explain this code block for a ${role} developer: ${block}`;
        const explanation = await callLLM(explanationPrompt);
        blocksHtml += `<pre>${block}</pre><p>${explanation}</p>`;
      }

      html += `
<li><strong>${file}</strong>
<p>${purpose}</p>
${blocksHtml}
</li>`;
    }
    html += '</ul>';
  }

  html += '</body></html>';
  return html;
}

// Generate critical tasks from ESLint
async function generateCriticalTasks(modules, repoPath) {
  let projectConfig = {};
  try {
    const cfgText = await fs.readFile(path.resolve(process.cwd(), '.eslintrc.json'), 'utf-8');
    projectConfig = JSON.parse(cfgText);
  } catch (e) {
    console.warn('Could not load .eslintrc.json:', e.message);
  }

const eslint = new ESLint({
    cwd: process.cwd(),
    useEslintrc: true,
    overrideConfig: {
      extends: ['eslint:recommended'],
      ...projectConfig
    }
  });

  const filePaths = [];
  for (const module of modules) {
    const dirPath = path.join(repoPath, module.module);
    const files = await fs.readdir(dirPath);
    filePaths.push(
      ...files.filter((f) => f.endsWith('.js')).map((f) => path.join(dirPath, f))
    );
  }
  console.log('About to lint these files:', filePaths);
  let results = [];
  try {
    results = await eslint.lintFiles(filePaths);
  } catch (err) {
    console.warn('ESLint lintFiles failed:', err.message);
    return [];
  }

  const tasks = [];
  for (const fileResult of results) {
    for (const issue of fileResult.messages.slice(0, 5)) {
      const prompt = `Rephrase lint issue into an actionable task: "${issue.message}" in ${fileResult.filePath}:${issue.line}`;
      const desc = await callLLM(prompt);
      tasks.push({
        title: `Fix ${path.basename(fileResult.filePath)}`,
        description: desc,
        file: fileResult.filePath,
        line: issue.line,
        severity: issue.severity
      });
    }
  }

  return tasks;
}


module.exports = { startFlow, nextStep };
