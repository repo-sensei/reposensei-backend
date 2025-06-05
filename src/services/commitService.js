const { getCommitHistory } = require('./gitService');

async function fetchCommits(repoPath) {
  const commits = await getCommitHistory(repoPath);
  return commits; // array of { sha, message, author, date }
}

module.exports = { fetchCommits };
