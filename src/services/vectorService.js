const axios = require('axios');
const supabase = require('../config/supabase');

const HF_API_URL = 'https://api-inference.huggingface.co/embed/sentence-transformers/all-MiniLM-L6-v2';
const HF_TOKEN = process.env.LLM_API_TOKEN;

// 1) Call Hugging Face to embed a piece of text
async function embedText(text) {
  const response = await axios.post(
    HF_API_URL,
    { inputs: text },
    { headers: { Authorization: `Bearer ${HF_TOKEN}` } }
  );
  return response.data; // array of floats
}

// 2) Insert embedding into Supabase
async function upsertCodeEmbedding(repoId, type, refId, textToEmbed, metadata) {
  const embedding = await embedText(textToEmbed);
  const { data, error } = await supabase
    .from('code_embeddings')
    .insert([
      {
        repo_id: repoId,
        type,
        ref_id: refId,
        embedding,
        metadata
      }
    ]);
  if (error) console.error('Supabase insert error:', error);
  return data;
}

// 3) Semantic search using the RPC match_embedding
async function searchEmbeddings(repoId, query, type, k = 5) {
  const queryEmbedding = await embedText(query);
  const { data, error } = await supabase.rpc('match_embedding', {
    query_embedding: queryEmbedding,
    match_type: type,
    repo_id: repoId,
    k
  });
  if (error) console.error('Supabase RPC error:', error);
  return data; // array of { ref_id, distance }
}

module.exports = { embedText, upsertCodeEmbedding, searchEmbeddings };
