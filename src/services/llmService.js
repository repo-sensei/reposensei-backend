// src/services/llmService.js
const axios = require('axios');

async function callLLM(prompt) {
  const response = await axios.post(
    process.env.PYTHON_BACKEND_URL + '/generate',
    { prompt }
  );
  // Assume backend returns { text: "..." }
  return response.data.text;
}

module.exports = { callLLM };
