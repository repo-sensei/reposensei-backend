require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const repoRouter = require('./controllers/repoController');
const docsRouter = require('./controllers/docsController');
const tasksRouter = require('./controllers/tasksController');
const changeRouter = require('./controllers/changeController');
const chatRouter = require('./controllers/chatController');
const webhookRouter = require('./controllers/webhookController');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/repo', repoRouter);
app.use('/api/docs', docsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/changes', changeRouter);
app.use('/api/chat', chatRouter);
app.use('/api/webhook', webhookRouter);

// Start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
