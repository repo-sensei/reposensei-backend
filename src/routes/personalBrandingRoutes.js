import express from 'express';
import { generateResumeSection } from '../controllers/personalBrandingController';

const router = express.Router();

// Endpoint for Resume Section Generation
// Expects JSON body: { repoUrl, repoId, userId, role?, projectName?, startDate?, endDate? }
router.post('/personal-branding/resume-section', generateResumeSection);

export default router;
