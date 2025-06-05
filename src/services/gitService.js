const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

const tmpBase = path.join(os.tmpdir(), 'reposensei');

async function cloneRepo(repoUrl, repoId) {
  const repoPath = path.join(tmpBase, repoId);
  await fs.remove(repoPath);
  const git = simpleGit();
  await git.clone(repoUrl, repoPath, ['--depth', '50']); // shallow clone
  return repoPath;
}

async function getCommitHistory(repoPath) {
  const git = simpleGit(repoPath);
  const log = await git.log({ maxCount: 50 });
  return log.all.map(c => ({
    sha: c.hash,
    message: c.message,
    author: c.author_name,
    date: c.date
  }));
}

module.exports = { cloneRepo, getCommitHistory };
