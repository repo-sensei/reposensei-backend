require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db');
const path = require('path');

const repoRouter = require('./src/controllers/repoController');
const docsRouter = require('./src/controllers/docsController');
const tasksRouter = require('./src/controllers/tasksController');
const changeRouter = require('./src/controllers/changeController');
const chatRouter = require('./src/controllers/chatController');
const webhookRouter = require('./src/controllers/webhookController');
const onboardingRouter = require('./src/controllers/onboardingController');
const personalBrandingRouter = require('./src/routes/personalBrandingRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewaresapi/
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/repo', repoRouter);
app.use('/api/docs', docsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/changes', changeRouter);
app.use('/api/chat', chatRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/generated', express.static(path.join(__dirname, 'docs/generated')));
app.use('/api/personal-branding', personalBrandingRouter);

// Start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
