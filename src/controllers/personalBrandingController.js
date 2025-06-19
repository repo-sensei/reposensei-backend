const { createResumeSection } = require('../services/personalBrandingService');

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

module.exports = {
  generateResumeSection
};
