export function buildPrompt(commits, metrics, { role, projectName, startDate, endDate }) {
  const header = `Role: ${role || 'Developer'}\nProject: ${projectName || 'Personal Project'}\nTimeframe: ${startDate || 'Start'} – ${endDate || 'Now'}`;

  // Facts from commits with GitHub API data
  const facts = commits.slice(0, 20).map(c => (
    `• ${c.message} on ${new Date(c.date).toDateString()} affecting ${c.files.length} files (+${c.stats.additions}/-${c.stats.deletions} LOC)`
  )).join('\n');

  // Enhanced metrics summary with GitHub API data
  const metricLines = [
    `Total LOC +${metrics.totalAdded}/-${metrics.totalDeleted}`,
    `Total commits: ${commits.length}`,
    `Total PRs: ${metrics.totalPRs} (${metrics.mergedPRs} merged)`,
    `Total issues: ${metrics.totalIssues}`,
    `Avg commits per day: ${Object.values(metrics.commitsPerDay).reduce((a,b)=>a+b,0) / Math.max(Object.keys(metrics.commitsPerDay).length, 1)}`,
    `Tech stack: ${Object.entries(metrics.techDistribution).map(([e,p])=>`${e}:${p}%`).join(', ')}`,
    metrics.avgCycleTimeDays ? `Avg PR cycle time: ${metrics.avgCycleTimeDays} days` : ''
  ].filter(Boolean).map(m=>`• ${m}`).join('\n');

  // Issue/PR links list
  const links = metrics.prLinks.length
    ? '\nRelated PRs/Issues:\n' + metrics.prLinks.map(l=>`- ${l}`).join('\n')
    : '';

  return `You are a senior technical resume writer.
${header}

Key Contributions and Metrics:
${metricLines}

Commit Highlights:
${facts}${links}

Generate 4–6 concise, high‑impact resume bullet points capturing:
- Feature development and technical contributions
- Bug fixes and performance improvements  
- Code quality and best practices
- Collaboration and PR/issue management
- Growth milestones and learning outcomes

Use professional tone and focus on quantifiable achievements.`;
}

