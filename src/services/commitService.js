const { getRecentCommitsWithFiles } = require('./gitService');

async function fetchCommits(repoPath) {
  console.log(repoPath);
  const commits = await getRecentCommitsWithFiles(repoPath);
  return commits;
}

module.exports = { fetchCommits };
