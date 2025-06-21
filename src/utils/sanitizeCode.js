// utils/sanitizeCode.js

function sanitizeCode(code) {
  if (!code || typeof code !== 'string') return '';

  let cleaned = code;

  // 1. .env-style secrets
  cleaned = cleaned.replace(/^[A-Z_][A-Z0-9_]*\s*=\s*["']?.+["']?/gm, '<REDACTED_ENV_VAR>');

  // 2. API keys, tokens, secrets
  cleaned = cleaned.replace(
    /(["']?(?:API|TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*["']?\s*[:=]\s*)["'][^"']+["']/gi,
    '$1"<REDACTED>"'
  );

  // 3. Emails
  cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<REDACTED_EMAIL>');

  // 4. IPs
  cleaned = cleaned.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<REDACTED_IP>');

  // 5. PEM/Keys
  cleaned = cleaned.replace(/-----BEGIN [^-]+-----[\s\S]+?-----END [^-]+-----/g, '<REDACTED_PRIVATE_KEY>');

  // 6. Sensitive comments
  cleaned = cleaned.replace(/\/\/.*(fix|client|prod|password|secret|token|temp|hack).*/gi, '// <REDACTED_COMMENT>');

  // 7. File paths
  cleaned = cleaned.replace(/(\/?[\w-]+)+\.(js|jsx|ts|tsx)/g, '/sanitized-file.$2');

  // 8. Database URLs (MongoDB, PostgreSQL, MySQL, etc.)
  cleaned = cleaned.replace(
    /(mongodb|postgres(ql)?|mysql|redis):\/\/[^'" \n]+/gi,
    '<REDACTED_DB_URL>'
  );

  // 9. Production/internal URLs
  cleaned = cleaned.replace(
    /https?:\/\/[a-z0-9\.\-]+(\.internal|\.local|\.prod|\.company|\.corp|\.cloud|\.io)?(:\d+)?[^\s"']*/gi,
    '<REDACTED_URL>'
  );

  return cleaned;
}

module.exports = sanitizeCode;
