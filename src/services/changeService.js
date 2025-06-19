const CommitModel = require('../models/Commit');
const axios = require('axios');

async function summarizeChanges(repoId, sinceDate) {
  
  const recentCommits = await CommitModel.find({
    repoId,
    date: { $gt: sinceDate }
  }).sort({ date: 1 });

  if (recentCommits.length === 0) {
    return { summary: {}, rawText: 'No new changes since last scan.' };
  }

  const changesText = recentCommits
    .map(c => {
      let bullet = `- ${c.message} (by ${c.author})`;
      if (c.filesChanged?.length) {
        const files = c.filesChanged.slice(0, 10);
        bullet += `\n  Files changed: ${files.join(', ')}`;
        if (c.filesChanged.length > 10) {
          bullet += `, and ${c.filesChanged.length - 10} more`;
        }
      }
      return bullet;
    })
    .join('\n');

    const promptAI = `
    You're a senior dev. Summarize these changes (since ${sinceDate.toDateString()} in "${repoId}") into 5 sections:

    - New Features
    - Refactors
    - Fixes & Performance
    - Testing
    - Documentation

    For each section, return a JSON array with:
    - author
    - files (array)
    - type (new | refactor | fix | test | docs)
    - description (how it may impact the project, plain text)

    Changes:
    ${changesText}

    Only return valid JSON.
    `;

  try {
    const res = await axios.post(
      `${process.env.PYTHON_BACKEND_URL}/summarize`,
      { prompt: promptAI }
    );

  
    const cleaned = res.data.summary
      .trim()
      .replace(/^```(?:json)?/, '')  // Remove starting ``` or ```json
      .replace(/```$/, '')           // Remove ending ```
      .trim();

    const parsed = JSON.parse(cleaned);

    return { summary: parsed, rawText: changesText };
  } catch (err) {
    console.error('Summarization failed:', err);
    throw err;
  }
}

module.exports = { summarizeChanges };
