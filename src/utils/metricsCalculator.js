import simpleGit from 'simple-git';
const axios = require('axios');
const fs = require('fs');

// Read GitHub token from Docker secret
let GITHUB_TOKEN;
try {
  GITHUB_TOKEN = fs.readFileSync('/run/secrets/github_token', 'utf8').trim();
} catch (error) {
  // Fallback to environment variable for development
  GITHUB_TOKEN = process.env.GITHUB_TOKEN;
}

if (!GITHUB_TOKEN) {
  console.warn('GITHUB_TOKEN not found. Falling back to commit message parsing.');
}

/**
 * Get PRs associated with a commit using GitHub API
 */
async function getPRsForCommit(commitSha, owner, repo) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  
  if (!GITHUB_TOKEN) {
    console.warn('GITHUB_TOKEN not found. Falling back to commit message parsing.');
    return [];
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}/pulls`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (response.ok) {
      const pulls = await response.json();
      return pulls.map(pr => pr.html_url);
    } else if (response.status === 404) {
      // No PRs associated with this commit
      return [];
    } else {
      console.warn(`GitHub API error for commit ${commitSha}: ${response.status}`);
      return [];
    }
  } catch (error) {
    console.warn(`Failed to get PRs for commit ${commitSha}:`, error.message);
    return [];
  }
}

/**
 * Compute metrics: LOC, time-series, tech-distribution, PR/issue links, cycle time
 */
export async function computeMetrics(commits, { repoRoot, repoUrl }) {
  const git = simpleGit(repoRoot);
  let totalAdded = 0, totalDeleted = 0;
  const dailyCount = {};
  const techCount = {};
  const prLinks = new Set();
  const cycleTimes = [];

  // Extract repo info from repoUrl for GitHub API
  const repoUrlParts = repoUrl.split('/');
  const owner = repoUrlParts[3];
  const repo = repoUrlParts[4];

  // Fallback patterns for when GitHub API is not available
  const patterns = [
    /#(\d+)/,                                    // #123
    /(?:PR|pull request)\s*#?(\d+)/i,           // PR #123, pull request 123
    /(?:issue|bug)\s*#?(\d+)/i,                 // issue #123, bug 123
    /(?:close|closes|closed|fix|fixes|fixed)\s+#(\d+)/i  // closes #123
  ];

  for (const c of commits) {
    // Diff stats
    const diffStat = await git.diffSummary([`${c.sha}^!`]);
    totalAdded += diffStat.insertions;
    totalDeleted += diffStat.deletions;

    // Daily commits
    const day = new Date(c.date);
    day.setHours(0,0,0,0);
    const key = day.toISOString().slice(0,10);
    dailyCount[key] = (dailyCount[key] || 0) + 1;

    // Tech distribution by file extension
    for (const file of c.filesChanged) {
      const ext = file.split('.').pop().toLowerCase();
      techCount[ext] = (techCount[ext] || 0) + 1;
    }

    // Get PRs from GitHub API (primary method)
    const associatedPRs = await getPRsForCommit(c.sha, owner, repo);
    associatedPRs.forEach(prUrl => prLinks.add(prUrl));

    // Fallback: PR/issue in message (if no PRs found via API)
    if (associatedPRs.length === 0) {
      for (const pattern of patterns) {
        const match = c.message.match(pattern);
        if (match) {
          prLinks.add(`${repoUrl}/issues/${match[1]}`);
          break;
        }
      }
    }

    // Cycle time: if merge commit message has "Merge pull request" and references PR
    if (/Merge pull request #\d+/.test(c.message) && c.mergedAt) {
      const created = new Date(c.createdAt);
      const merged = new Date(c.mergedAt);
      cycleTimes.push((merged - created)/(1000*3600*24)); // days
    }
  }

  // Tech distribution %
  const totalTech = Object.values(techCount).reduce((a,b)=>a+b,0);
  const techDist = {};
  for (const [ext, cnt] of Object.entries(techCount)) {
    techDist[ext] = Math.round((cnt/totalTech)*100);
  }

  const avgCycle = cycleTimes.length
    ? (cycleTimes.reduce((a,b)=>a+b,0)/cycleTimes.length).toFixed(1)
    : null;

  return {
    totalAdded,
    totalDeleted,
    commitsPerDay: dailyCount,
    techDistribution: techDist,
    prLinks: Array.from(prLinks),
    avgCycleTimeDays: avgCycle
  };
}

