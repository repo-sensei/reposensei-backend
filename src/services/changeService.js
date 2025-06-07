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
You are a senior software engineer who writes detailed, high-level change reports for a developer audience. Below are the recent commits since ${sinceDate.toDateString()} in the "${repoId}" repository:

${changesText}

For each bullet, describe what the contributor did, including file-level details. 
- If a React component file was added (e.g. ends in .jsx or .tsx), mention that "a new React component named <ComponentName> was introduced to handle <feature>. Whichever file was changed, write the content accordingly."
- If server/API files were changed, mention the new endpoint or logic as appropriate.
- Group related changes under the same contributor or timeframe if possible.
Write a **detailed 300-word summary**, using bullet points or short paragraphs for clarity. Focus on:
1. New features added (what functionality was introduced and where).
2. Major refactors (which files or modules were reorganized).
3. Bug fixes or performance improvements (mention specific components or backend code if visible).
4. Any new tests or documentation updates (if commit messages mention them).

Output the text—do not reprint the individual bullets.
  `;

  try {
    const res = await axios.post(
      `${process.env.PYTHON_BACKEND_URL}/summarize`,
      { prompt: promptAI }
    );
    return res.data.summary;
  } catch (error) {
    console.error('Error calling Python backend summarizer:', error);
    throw error;
  }
}

module.exports = { summarizeChanges };
