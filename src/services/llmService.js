// src/services/llmService.js
const axios = require('axios');

async function callLLM(prompt) {
  const response = await axios.post(
    process.env.PYTHON_BACKEND_URL + '/onboard',
    { prompt }
  );
   if (response.data.success) {
    return response.data.summary;
  } else {
    throw new Error(response.data.error || 'Unknown error from LLM backend');
  }

}

module.exports = { callLLM };
