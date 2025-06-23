const CommitModel = require('../models/Commit');
const axios = require('axios');
const fs = require('fs');

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

  
    let summary;
    let cleaned = null;
    try {
      // 1. Extract the summary string
      let summaryStr = res.data.summary;
      fs.writeFileSync('/tmp/raw_summary.txt', summaryStr);
      console.log('Raw summary string length:', summaryStr.length);
      console.log('Raw summary string:', summaryStr);

      // 2. Clean up the string: remove all code block markers and trim whitespace/newlines
      cleaned = summaryStr
        .replace(/```json|```/gi, '') // Remove all code block markers
        .trim();

      console.log('Cleaned summary string:', cleaned);

      summary = JSON.parse(cleaned);
    } catch (err) {
      console.error('Failed to parse summary JSON:', err, '\nFull cleaned string:', cleaned);
      throw err;
    }

    return { summary: summary, rawText: changesText };
  } catch (err) {
    console.error('Summarization failed:', err);
    throw err;
  }
}

module.exports = { summarizeChanges };
