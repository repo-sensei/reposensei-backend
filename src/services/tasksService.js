// src/services/taskService.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const TaskModel = require('../models/Task');

/** Helper: fetch up to `n` open GitHub issues */
async function fetchOpenIssues(repoId, n = 5) {
  try {
    const res = await axios.get(`https://api.github.com/repos/${repoId}/issues`, {
      params: { state: 'open', per_page: n },
      headers: { 'User-Agent': 'reposensei' }
    });
    return res.data.filter(issue => !issue.pull_request).slice(0, n);
  } catch {
    return [];
  }
}

/** Helper: scan all files for TODO/FIXME/BUG comments */
function scanTodoComments(repoPath) {
  const todos = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
        const lines = fs.readFileSync(full, 'utf-8').split('\n');
        lines.forEach((line, idx) => {
          const m = line.match(/\/\/\s*(TODO|FIXME|BUG):?(.*)/i);
          if (m) {
            todos.push({
              file: path.relative(repoPath, full),
              line: idx + 1,
              comment: m[2].trim() || '(no description)'
            });
          }
        });
      }
    }
  }
  walk(repoPath);
  return todos;
}

/** Scan for problematic code or "code smells" */
function scanCodeSmells(repoPath) {
  const smells = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|jsx)$/.test(entry.name)) {
        const src = fs.readFileSync(full, 'utf-8');
        const ast = parser.parse(src, {
          sourceType: 'unambiguous',
          plugins: ['jsx']
        });
        traverse(ast, {
          Function(pathNode) {
            let complexity = 1;
            pathNode.traverse({
              IfStatement() { complexity++; },
              ForStatement() { complexity++; },
              WhileStatement() { complexity++; },
              ConditionalExpression() { complexity++; },
              LogicalExpression(p) {
                if (['&&','||'].includes(p.node.operator)) complexity++;
              }
            });
            if (complexity > 10) {
              smells.push({
                file: path.relative(repoPath, full),
                line: pathNode.node.loc.start.line,
                type: 'High complexity',
                detail: `cyclomatic complexity = ${complexity}`
              });
            }
            const length = pathNode.node.loc.end.line - pathNode.node.loc.start.line + 1;
            if (length > 100) {
              smells.push({
                file: path.relative(repoPath, full),
                line: pathNode.node.loc.start.line,
                type: 'Long function',
                detail: `function spans ${length} lines`
              });
            }
          },
          CallExpression(pathNode) {
            const c = pathNode.node.callee;
            if (c.type === 'MemberExpression' && c.property.name === 'then') {
              const parent = pathNode.parentPath;
              const next = parent.getSibling(parent.key + 1);
              if (!next.node || next.node.callee?.property?.name !== 'catch') {
                smells.push({
                  file: path.relative(repoPath, full),
                  line: pathNode.node.loc.start.line,
                  type: 'Unhandled promise',
                  detail: '`then()` without `catch()`'
                });
              }
            }
          },
          MemberExpression(pathNode) {
            const o = pathNode.node.object;
            const p = pathNode.node.property;
            if (o.name === 'console' && ['log','warn','error','debug'].includes(p.name)) {
              smells.push({
                file: path.relative(repoPath, full),
                line: pathNode.node.loc.start.line,
                type: 'Console statement',
                detail: `console.${p.name}()`
              });
            }
          },
          DebuggerStatement(pathNode) {
            smells.push({
              file: path.relative(repoPath, full),
              line: pathNode.node.loc.start.line,
              type: 'Debugger',
              detail: '`debugger;` left in code'
            });
          },
          TryStatement(pathNode) {
            const handler = pathNode.node.handler;
            if (!handler) {
              smells.push({
                file: path.relative(repoPath, full),
                line: pathNode.node.loc.start.line,
                type: 'Missing catch',
                detail: '`try` without `catch`'
              });
            } else {
              const body = handler.body.body;
              const onlyLogging = body.every(stmt =>
                stmt.type === 'ExpressionStatement' &&
                stmt.expression.type === 'CallExpression' &&
                stmt.expression.callee.object?.name === 'console'
              );
              if (body.length === 0 || onlyLogging) {
                smells.push({
                  file: path.relative(repoPath, full),
                  line: handler.loc.start.line,
                  type: 'Swallowed error',
                  detail: '`catch` block is empty or only logs'
                });
              }
            }
          }
        });
      }
    }
  }
  walk(repoPath);
  return smells;
}

async function generateOnboardingTasks({ repoId, repoPath }) {
  const tasks = [];

  // 1) Architecture Overview
  const readmePath = ['README.md','README.MD','readme.md']
    .map(n => path.join(repoPath, n))
    .find(fs.existsSync);
  const readmeExcerpt = readmePath
    ? fs.readFileSync(readmePath, 'utf-8').slice(0, 3000)
    : '';

  const archPrompt = `
You are a senior developer onboarding a new team member. 
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
${readmeExcerpt}
"""
`;

  try {
    const resp = await axios.post(
      `${process.env.PYTHON_BACKEND_URL}/generate-architecture`,
      { prompt: archPrompt }
    );

    let raw = resp.data;
    // If wrapped in { success, response }, unwrap it:
    if (raw.success && typeof raw.response === 'string') {
      raw = raw.response;
    }
    // raw might be a JS object or a string
    let text = typeof raw === 'string' ? raw : JSON.stringify(raw);

    // --- CLEANUP: strip triple-backtick fences and any leading text ---
    // Remove ```json or ``` at start, and trailing ``` if present
    text = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    // Now isolate the first { ... } block
    const firstBrace = text.indexOf('{');
    const lastBrace  = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }

    // Parse JSON
    const result = JSON.parse(text);

    // Push overview
    tasks.push({
      repoId,
      title: 'Architecture Overview',
      description: result.overview,
      command: '# Review the above architecture summary',
      fileLink: readmePath ? path.relative(repoPath, readmePath) : null,
      isCompleted: false
    });

    // Push suggestedTasks
    if (Array.isArray(result.suggestedTasks)) {
      result.suggestedTasks.forEach((txt, i) => {
        tasks.push({
          repoId,
          title: `Arch Task ${i + 1}`,
          description: txt,
          command: `# ${txt}`,
          fileLink: null,
          isCompleted: false
        });
      });
    } else {
      console.warn('Architecture response missing suggestedTasks:', result);
    }
  } catch (e) {
    tasks.push({
      repoId,
      title: 'Architecture Overview',
      description: `Failed: ${e.message}`,
      command: '# Manually review README/code',
      fileLink: readmePath ? path.relative(repoPath, readmePath) : null,
      isCompleted: false
    });
  }


  // 2) GitHub Issues
  const issues = await fetchOpenIssues(repoId, 5);
  if (issues.length) {
    issues.forEach(issue => {
      tasks.push({
        repoId,
        title: `Fix Issue #${issue.number}: ${issue.title}`,
        description: issue.body || '(no description)',
        command: `# git fetch && git checkout -b fix/issue-${issue.number}`,
        fileLink: issue.html_url,
        isCompleted: false
      });
    });
  } else {
    // 3) Code Smells
    const smells = scanCodeSmells(repoPath);
    if (smells.length) {
      smells.slice(0, 5).forEach((s, i) => {
        tasks.push({
          repoId,
          title: `Fix ${s.type} in ${s.file}`,
          description: `${s.detail} at ${s.file}:${s.line}`,
          command: `# Open ${s.file}#L${s.line} and resolve`,
          fileLink: `file://${path.resolve(repoPath, s.file)}#L${s.line}`,
          isCompleted: false
        });
      });
    } else {
      // 4) TODO/FIXME Comments
      const todos = scanTodoComments(repoPath);
      if (todos.length) {
        todos.slice(0, 5).forEach((t, i) => {
          tasks.push({
            repoId,
            title: `Address ${t.comment}`,
            description: `Found in ${t.file} at line ${t.line}`,
            command: `# Open ${t.file}#L${t.line} and resolve`,
            fileLink: `file://${path.resolve(repoPath, t.file)}#L${t.line}`,
            isCompleted: false
          });
        });
      } else {
        // 5) AI-Brainstormed Tasks
        const prompt = `
You are a senior engineer brainstorming 5 high-value onboarding tasks for a new team member working on this codebase. Tasks should be:
• Project-specific (features to build, refactors to do, or tests to write).
• Non-trivial (not "run npm install", not "read" any file).
• Each task in one sentence.

Respond with a JSON array of 5 strings only.
`;
        try {
          const { data } = await axios.post(
            `${process.env.PYTHON_BACKEND_URL}/generate-tasks`,
            { prompt }
          );
          const list = Array.isArray(data.tasks)
            ? data.tasks
            : JSON.parse(data.tasks);
          list.slice(0, 5).forEach((text, idx) => {
            tasks.push({
              repoId,
              title: `Suggestion ${idx + 1}`,
              description: text,
              command: `# ${text}`,
              fileLink: null,
              isCompleted: false
            });
          });
        } catch {
          tasks.push({
            repoId,
            title: 'Explore Codebase',
            description: 'No issues, smells, or TODOs found; propose 2 tasks.',
            command: '# Review source and README',
            fileLink: null,
            isCompleted: false
          });
        }
      }
    }
  }

  await TaskModel.deleteMany({ repoId });
  return await TaskModel.insertMany(tasks);
}

module.exports = { generateOnboardingTasks };