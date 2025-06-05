const supabase = require('../config/supabase');
const NodeModel = require('../models/Node');
const CommitModel = require('../models/Commit');
const axios = require('axios');
const fs = require('fs');

async function embedText(text) {
  const HF_API_URL = 'https://api-inference.huggingface.co/embed/sentence-transformers/all-MiniLM-L6-v2';
  const HF_TOKEN = process.env.LLM_API_TOKEN;
  const response = await axios.post(
    HF_API_URL,
    { inputs: text },
    { headers: { Authorization: `Bearer ${HF_TOKEN}` } }
  );
  return response.data; // array of floats
}

async function answerQuestion(repoId, userId, question) {
  // 1) Get top 3 node matches
  const queryEmbedding = await embedText(question);
  const { data: nodeMatches } = await supabase.rpc('match_embedding', {
    query_embedding: queryEmbedding,
    match_type: 'node',
    repo_id: repoId,
    k: 3
  });
  // 2) Get top 2 commit matches
  const { data: commitMatches } = await supabase.rpc('match_embedding', {
    query_embedding: queryEmbedding,
    match_type: 'commit',
    repo_id: repoId,
    k: 2
  });

  // 3) Build contexts
  const contexts = [];
  for (const m of nodeMatches) {
    const n = await NodeModel.findOne({ nodeId: m.ref_id });
    if (n) {
      const content = fs.readFileSync(n.filePath, 'utf-8').split('\n');
      const snippet = content.slice(n.startLine - 1, n.endLine).join('\n');
      const nodeType = n.type === 'class' ? 'Class' : 'Function';
      contexts.push(`${nodeType} ${n.name}:\n${snippet}`);
    }
  }
  for (const m of commitMatches) {
    const c = await CommitModel.findOne({ sha: m.ref_id });
    if (c) {
      contexts.push(`Commit ${c.sha} by ${c.author}:\n${c.message}`);
    }
  }

  // 4) Build LLM prompt
  const prompt = `
You are an expert code mentor. Use these contexts:
${contexts.map(c => `---\n${c}`).join('\n')}

Question: "${question}"

Answer concisely and refer to function names or commit SHAs if needed.
  `;

  // 5) Call LLM
  const llmRes = await axios.post(
    process.env.LLM_API_URL,
    { inputs: prompt },
    { headers: { Authorization: `Bearer ${process.env.LLM_API_TOKEN}` } }
  );
  const answerText = llmRes.data;

  // 6) Save Q&A to Supabase
  const { data, error } = await supabase
    .from('chat_logs')
    .insert([{ repo_id: repoId, user_id: userId, question, answer: answerText }]);
  if (error) console.error('Supabase chat_logs error:', error);

  return answerText;
}

module.exports = { answerQuestion };
