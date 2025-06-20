const express = require('express');
const {
  generateResumeSection,
  getGitHubInsights
} = require('../controllers/personalBrandingController');

const router = express.Router();

router.post('/resume-section', generateResumeSection);
router.post('/github-insights', getGitHubInsights); // <-- New route

module.exports = router;
