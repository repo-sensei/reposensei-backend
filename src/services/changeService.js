const CommitModel = require('../models/Commit');
const axios = require('axios');

async function summarizeChanges(repoId, sinceDate) {
  
  const recentCommits = await CommitModel.find({
    repoId,
    date: { $gt: sinceDate }
  }).sort({ date: 1 }); // sort oldest -> newest


  if (recentCommits.length === 0) {
    return 'No new changes since last scan.';
  }

  // Build a detailed bullet list
  const changesText = recentCommits
    .map(c => {
      let bullet = `- ${c.message} (by ${c.author})`;
      if (Array.isArray(c.filesChanged) && c.filesChanged.length > 0) {
        // List up to 10 changed files; if more, summarize as "and X more..."
        const maxFilesToShow = 10;
        const shownFiles = c.filesChanged.slice(0, maxFilesToShow);
        bullet += `\n  Files changed: ${shownFiles.join(', ')}`;
        if (c.filesChanged.length > maxFilesToShow) {
          bullet += `, and ${c.filesChanged.length - maxFilesToShow} more`;
        }
      }
      return bullet;
    })
    .join('\n');

  const promptAI = `
You are a senior software engineer writing concise yet detailed change summaries for developers. Below are recent commits since ${sinceDate.toDateString()} in the "${repoId}" repository:

${changesText}

Summarize these changes with clear bullet points or short paragraphs. For each:
- Explain what the contributor did, including key file-level actions.
- If a React file (.jsx/.tsx) was added, say: "A new React component <ComponentName> was introduced for <feature>."
- If API/server files changed, mention the endpoint or logic update.
- Group similar changes by contributor or timeframe.

Focus on:
1. New features (functionality and location)
2. Refactors (which files/modules were reorganized)
3. Bug fixes/performance improvements (mention specific components if possible)
4. New tests or documentation (if commit messages indicate so)

Limit output to **around 500 words** or fewer.
Do **not** repeat the original bullets—just summarize.
  `;

  
  try {
   
    const res = await axios.post(
      `${process.env.PYTHON_BACKEND_URL}/summarize`,
      { prompt: promptAI }
    );
    console.log(res);
    return res.data.summary;
    

  } catch (error) {
    console.error('Error calling Python backend summarizer:', error);
    throw error;
  }
}

module.exports = { summarizeChanges };
