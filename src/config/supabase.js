const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read secrets from files
const SUPABASE_URL = fs.readFileSync(process.env.SUPABASE_URL_FILE, 'utf8').trim();
const SERVICE_ROLE_KEY = fs.readFileSync(process.env.SUPABASE_SERVICE_ROLE_KEY_FILE, 'utf8').trim();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

module.exports = supabase;
