const { getRecentCommitsWithFiles } = require('./gitService');

async function fetchCommits(repoPath) {
  const commits = await getRecentCommitsWithFiles(repoPath);
  return commits;
}

module.exports = { fetchCommits };
