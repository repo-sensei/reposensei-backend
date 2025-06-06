const CommitModel = require('../models/Commit'); 
const axios = require('axios');

async function summarizeChanges(repoId, sinceDate) {
  const recentCommits = await CommitModel.find({ repoId, date: { $gt: sinceDate } });
  if (recentCommits.length === 0) return 'No new changes since last scan.';

  const changesText = recentCommits
    .map(c => `- ${c.message} (by ${c.author})`)
    .join('\n');

  const promptAI = `
You are a senior engineer. Here are recent commit messages since ${sinceDate.toDateString()}:
${changesText}

Write a 200-word summary using pointers describing what changed in this repository. Focus on high-level features or refactors. Output only the summary text.
  `;


  try {
    const res = await axios.post(`${process.env.PYTHON_BACKEND_URL}/summarize`, { prompt: promptAI });
    
    return res.data.summary;
  } catch (error) {
    console.error('Error calling Python backend summarizer:', error);
    throw error;
  }
}

module.exports = { summarizeChanges };
