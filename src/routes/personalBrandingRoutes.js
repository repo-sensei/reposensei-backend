const express = require('express');
const { generateResumeSection } = require('../controllers/personalBrandingController');

const router = express.Router();

router.post('/resume-section', generateResumeSection);

module.exports = router;
