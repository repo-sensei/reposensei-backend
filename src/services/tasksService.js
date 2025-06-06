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

  // 2) Architecture overview via Python Ollama backend
const readmeContent = readReadme(repoPath).substring(0, 3000);

const archPrompt = `
You are an expert senior developer onboarding a new team member. 
Given the following README excerpt, provide a concise 10-sentence summary of the repository’s architecture, including frontend/backend, key modules, and important areas a newcomer should focus on. 
Also, list 3 suggested first tasks for onboarding based on this architecture. 

Return only valid JSON in this exact format, with no extra text or duplicated keys: 
{
  "overview": "...",
  "suggestedTasks": [
    "Task 1 description",
    "Task 2 description",
    "Task 3 description"
  ]
}

README excerpt:
"""
${readmeContent}
"""
`;



let archOverview = '';
try {
  const response = await axios.post(`${process.env.PYTHON_BACKEND_URL}/generate-architecture`, {
    prompt: archPrompt
  });
  const data = response.data;
 

  if (data.success) {
    let cleaned = data.response.trim();

    // 🧹 Remove Markdown code block if present
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(cleaned);
    archOverview = parsed.overview;

    // ✅ Add main architecture overview task
    tasks.push({
      repoId,
      title: 'Review architecture overview',
      description: archOverview,
      command: '# Read the architecture overview above carefully',
      fileLink: null,
      isCompleted: false
    });

    // ✅ Add suggested tasks from the response
    if (Array.isArray(parsed.suggestedTasks)) {
      parsed.suggestedTasks.forEach((taskText, index) => {
        tasks.push({
          repoId,
          title: `Suggested Task ${index + 1}`,
          description: taskText,
          command: `# ${taskText}`,
          fileLink: null,
          isCompleted: false
        });
      });
    }

  } else {
    archOverview = `Error generating overview: ${data.error}`;

    tasks.push({
      repoId,
      title: 'Error generating architecture overview',
      description: archOverview,
      command: '# Check backend logs or prompt format',
      fileLink: null,
      isCompleted: false
    });
  }
} catch (err) {
  archOverview = `Failed to call Python backend: ${err.message}`;

  tasks.push({
    repoId,
    title: 'Backend call failed',
    description: archOverview,
    command: '# Check network or backend server',
    fileLink: null,
    isCompleted: false
  });
}


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
