const fs = require('fs');
const path = require('path');
const NodeModel = require('../models/Node');
const CommitModel = require('../models/Commit');
const TaskModel = require('../models/Task');
const axios = require('axios');

// Helper to read README if exists
function readReadme(repoPath) {
  const readmePaths = ['README.md', 'README.MD', 'readme.md'];
  for (const name of readmePaths) {
    const full = path.join(repoPath, name);
    if (fs.existsSync(full)) {
      return fs.readFileSync(full, 'utf-8');
    }
  }
  return '';
}

async function generateOnboardingTasks({ repoId, repoPath }) {
  const tasks = [];

  // 1) Set up environment
  const setupCmd = `cd ${repoPath} && npm install && npm run dev`;
  tasks.push({
    repoId,
    title: 'Set up local environment',
    description: 'Clone the repo, install dependencies, and run the dev server.',
    command: setupCmd,
    fileLink: null,
    isCompleted: false
  });

  // 2) Architecture overview via LLM
  const readmeContent = readReadme(repoPath).substring(0, 3000);
  const archPrompt = `
You are a senior developer. Given this README excerpt:
\`\`\`
${readmeContent}
\`\`\`
Write a 10-sentence overview of the repository’s architecture (frontend/backend and key modules). Output JSON: { "overview": "..." }.
`;
  const archRes = await axios.post(
    process.env.LLM_API_URL,
    { inputs: archPrompt },
    { headers: { Authorization: `Bearer ${process.env.LLM_API_TOKEN}` } }
  );
  let archOverview = '';
  try {
    const json = JSON.parse(archRes.data);
    archOverview = json.overview;
  } catch {
    archOverview = archRes.data;
  }
  tasks.push({
    repoId,
    title: 'Review architecture overview',
    description: archOverview,
    command: '',
    fileLink: null,
    isCompleted: false
  });

  // 3) Starter issue from GitHub issues (if public)
  let issueTask = null;
  try {
    const repoFull = repoId; // e.g. 'org/repo'
    const githubRes = await axios.get(`https://api.github.com/repos/${repoFull}/issues?state=open&per_page=1`);
    if (githubRes.data.length > 0) {
      const issue = githubRes.data[0];
      issueTask = {
        repoId,
        title: `Fix Issue #${issue.number}: ${issue.title}`,
        description: `Guided fix: see issue description at ${issue.html_url}`,
        command: `# Check out the issue at ${issue.html_url}`,
        fileLink: issue.html_url,
        isCompleted: false
      };
      tasks.push(issueTask);
    }
  } catch (e) {
    // ignore if private or no issues
  }

  // 4) Run tests (if package.json has test script)
  const pkgJsonPath = path.join(repoPath, 'package.json');
  let hasTestScript = false;
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    if (pkg.scripts && pkg.scripts.test) hasTestScript = true;
  }
  tasks.push({
    repoId,
    title: 'Run test suite',
    description: hasTestScript
      ? 'Execute `npm test` to verify existing tests pass and review coverage.'
      : 'No test script found; create a test for a core function.',
    command: hasTestScript ? `cd ${repoPath} && npm test` : `# Add tests for core functions`,
    fileLink: null,
    isCompleted: false
  });

  // 5–7) Top 3 complex nodes
  const topNodes = await NodeModel.find({ repoId }).sort({ complexity: -1 }).limit(3);
  topNodes.forEach((n) => {
    tasks.push({
      repoId,
      title: `Explore complex function: ${n.name}`,
      description: `Inspect the code in ${n.filePath} lines ${n.startLine}-${n.endLine} and understand its logic.`,
      command: `# Open ${n.filePath} in your editor`,
      fileLink: `file://${path.resolve(repoPath, n.filePath)}#L${n.startLine}-L${n.endLine}`,
      isCompleted: false
    });
  });

  // Clear existing tasks and insert new ones
  await TaskModel.deleteMany({ repoId });
  const created = await TaskModel.insertMany(tasks);
  return created;
}

module.exports = { generateOnboardingTasks };
