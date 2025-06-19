/**
 * Format the AI bullets into a resume section text
 */
export function formatResumeSection({ role, projectName, startDate, endDate, bullets }) {
  const header = `### ${role || 'Developer'} | ${projectName || ''} (${startDate || ''} – ${endDate || 'Present'})\n`;
  const bulletLines = bullets.map(b => `- ${b.trim()}`).join('\n');
  return `${header}${bulletLines}`;
}
