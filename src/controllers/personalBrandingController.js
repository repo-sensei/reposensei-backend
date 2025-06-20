const { createResumeSection, getContributionsAndMetrics  } = require('../services/personalBrandingService');

/**
 * Controller: orchestrates fetching contributions, computing metrics,
 * generating AI bullets, formatting section, and responding.
 */
async function generateResumeSection(req, res) {
  try {
    const { repoUrl, repoId, userId, role, projectName, startDate, endDate } = req.body;
    if (!repoUrl || !repoId || !userId) {
      return res.status(400).json({ error: 'repoUrl, repoId and userId are required' });
    }

    const sectionText = await createResumeSection({ repoUrl, repoId, userId, role, projectName, startDate, endDate });
    return res.status(200).json({ resumeSection: sectionText });
  } catch (err) {
    console.error('Error in generateResumeSection:', err);
    return res.status(500).json({ error: 'Failed to generate resume section' });
  }
}

async function getGitHubInsights(req, res) {
  try {
    const { repoUrl, userId, startDate, endDate } = req.body;
    if (!repoUrl || !userId) {
      return res.status(400).json({ error: 'repoUrl and userId are required' });
    }

    const { contributions, metrics } = await getContributionsAndMetrics({ repoUrl, userId, startDate, endDate });
    return res.status(200).json({ contributions, metrics });
  } catch (err) {
    console.error('Error in getGitHubInsights:', err);
    return res.status(500).json({ error: 'Failed to fetch GitHub insights' });
  }
}

module.exports = {
  generateResumeSection,
  getGitHubInsights
};