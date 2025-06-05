require('dotenv').config();
const axios = require('axios');
const supabase = require('../config/supabase');

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL;
const EMBED_ENDPOINT = `${PYTHON_BACKEND_URL}/embed`;

// 1) Call Python backend to embed a piece of text
async function embedText(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Invalid input: Text must be a non-empty string');
  }

  try {
    const response = await axios.post(
      EMBED_ENDPOINT,
      { text },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    if (!response.data || !Array.isArray(response.data.embedding)) {
      throw new Error('Unexpected response format from embedding API');
    }
    return response.data.embedding;
  } catch (error) {
    console.error('Python embedding API error:', error?.response?.data || error.message);
    throw new Error('Failed to generate embedding');
  }
}


// 2) Insert embedding into Supabase
async function upsertCodeEmbedding(repoId, type, refId, textToEmbed, metadata) {
  try {
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
    if (error) {
      console.error('Supabase insert error:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Embedding or insertion failed:', err.message);
    return null;
  }
}

// 3) Semantic search using the RPC match_embedding
async function searchEmbeddings(repoId, query, type, k = 5) {
  try {
    const queryEmbedding = await embedText(query);
    const { data, error } = await supabase.rpc('match_embedding', {
      query_embedding: queryEmbedding,
      match_type: type,
      repo_id: repoId,
      k
    });
    if (error) {
      console.error('Supabase RPC error:', error);
      return [];
    }
    return data;
  } catch (err) {
    console.error('Semantic search failed:', err.message);
    return [];
  }
}

module.exports = { embedText, upsertCodeEmbedding, searchEmbeddings };
