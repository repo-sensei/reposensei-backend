const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');

/**
 * Ensure the repository is cloned (or pulled) under a temp directory.
 * Returns the absolute path to the local clone.
 */
async function ensureRepoCloned(repoUrl, repoId) {
  const repoRoot = path.join(require('os').tmpdir(), 'reposensei', repoId);
  const git = simpleGit();

  if (fs.existsSync(repoRoot)) {
    // Already cloned locally → just pull the latest
    const repoGit = simpleGit(repoRoot);
    await repoGit.pull();
  } else {
    // Not cloned yet → do a fresh clone
    await git.clone(repoUrl, repoRoot);
  }
  return repoRoot;
}

/**
 * Fetch up to 50 recent commits with filenames changed.
 * Each commit object contains:
 *   { sha, author, date, message, filesChanged: [ 'file1.js', 'file2.jsx', ... ] }
 */
async function getRecentCommitsWithFiles(repoRoot) {
  const git = simpleGit(repoRoot);
  // Use --name-only to include the list of changed files in each commit
  // Format: "<SHA>|<author>|<iso-date>|<commit message>\n<file1>\n<file2>\n\n"
  const rawLog = await git.raw([
    'log',
    '-n',
    '50',
    '--pretty=format:%H|%an|%ad|%s',
    '--date=iso',
    '--name-only'
  ]);

  const blocks = rawLog.split('\n\n').filter(block => block.trim());
  const commits = [];

  for (const block of blocks) {
    // Each block: first line is "SHA|author|date|message"
    // Subsequent lines (until blank) are the filenames changed
    const lines = block.split('\n').filter(line => line.trim());
    if (!lines.length) continue;

    const [header, ...fileLines] = lines;
    const [sha, author, dateStr, ...msgParts] = header.split('|');
    const message = msgParts.join('|');
    const filesChanged = fileLines
      .map(f => f.trim())
      .filter(f => f.length > 0);

    commits.push({
      sha,
      author,
      date: new Date(dateStr),
      message,
      filesChanged
    });
  }

  return commits;
}

module.exports = { ensureRepoCloned, getRecentCommitsWithFiles };
