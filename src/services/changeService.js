const CommitModel = require('../models/Commit');
const axios = require('axios');

async function summarizeChanges(repoId, sinceDate) {
  // Fetch commits after sinceDate
  const recentCommits = await CommitModel.find({ repoId, date: { $gt: sinceDate } });
  if (recentCommits.length === 0) return 'No new changes since last scan.';

  const changesText = recentCommits
    .map(c => `- ${c.message} (by ${c.author})`)
    .join('\n');

  const prompt = `
You are a senior engineer. Here are recent commit messages since ${sinceDate.toDateString()}:
${changesText}

Write a 200-word summary describing what changed in this repository since ${sinceDate.toDateString()}. Focus on high-level features or refactors. Output only the summary text.
  `;

  const llmRes = await axios.post(
    process.env.LLM_API_URL,
    { inputs: prompt },
    { headers: { Authorization: `Bearer ${process.env.LLM_API_TOKEN}` } }
  );
  return llmRes.data;
}

module.exports = { summarizeChanges };
