import ResumeCache from '../models/ResumeSection';
import { buildPrompt } from '../utils/promptBuilder';
import { formatResumeSection } from '../utils/formatter';
import axios from 'axios';
import supabase from '../config/supabase';

/**
 * Get user's GitHub contributions using GitHub API
 */
async function getGitHubContributions(repoUrl, username, startDate, endDate) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN not found. Required for personal branding feature.');
  }

  // Extract repo info from repoUrl
  const repoUrlParts = repoUrl.split('/');
  const owner = repoUrlParts[3];
  const repo = repoUrlParts[4];

  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  };

  try {
    // 1. Get user's commits in this repo
    const commitsResponse = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits`,
      {
        headers,
        params: {
          author: username,
          since: startDate,
          until: endDate,
          per_page: 100
        }
      }
    );

    // 2. Get user's PRs in this repo
    const prsResponse = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        headers,
        params: {
          state: 'all',
          author: username,
          per_page: 100
        }
      }
    );

    // 3. Get user's issues in this repo
    const issuesResponse = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        headers,
        params: {
          state: 'all',
          creator: username,
          per_page: 100
        }
      }
    );

    // 4. Get detailed commit stats
    const commitsWithStats = await Promise.all(
      commitsResponse.data.map(async (commit) => {
        try {
          const statsResponse = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}`,
            { headers }
          );
          return {
            sha: commit.sha,
            message: commit.commit.message,
            date: commit.commit.author.date,
            author: commit.commit.author.name,
            stats: statsResponse.data.stats,
            files: statsResponse.data.files?.map(f => f.filename) || []
          };
        } catch (error) {
          return {
            sha: commit.sha,
            message: commit.commit.message,
            date: commit.commit.author.date,
            author: commit.commit.author.name,
            stats: { additions: 0, deletions: 0, total: 0 },
            files: []
          };
        }
      })
    );

    return {
      commits: commitsWithStats,
      pullRequests: prsResponse.data,
      issues: issuesResponse.data.filter(issue => !issue.pull_request), // Exclude PRs
      repoInfo: {
        name: repo,
        owner: owner,
        fullName: `${owner}/${repo}`
      }
    };

  } catch (error) {
    console.error('GitHub API error:', error.response?.data || error.message);
    throw new Error(`Failed to fetch GitHub data: ${error.message}`);
  }
}

/**
 * Calculate metrics from GitHub API data
 */
function calculateMetrics(contributions) {
  const { commits, pullRequests, issues } = contributions;
  
  let totalAdded = 0, totalDeleted = 0;
  const dailyCount = {};
  const techCount = {};
  const prLinks = new Set();

  // Process commits
  commits.forEach(commit => {
    // LOC stats
    totalAdded += commit.stats.additions || 0;
    totalDeleted += commit.stats.deletions || 0;

    // Daily commits
    const day = new Date(commit.date);
    day.setHours(0, 0, 0, 0);
    const key = day.toISOString().slice(0, 10);
    dailyCount[key] = (dailyCount[key] || 0) + 1;

    // Tech distribution
    commit.files.forEach(file => {
      const ext = file.split('.').pop()?.toLowerCase();
      if (ext) {
        techCount[ext] = (techCount[ext] || 0) + 1;
      }
    });
  });

  // Process PRs
  pullRequests.forEach(pr => {
    prLinks.add(pr.html_url);
  });

  // Tech distribution %
  const totalTech = Object.values(techCount).reduce((a, b) => a + b, 0);
  const techDist = {};
  for (const [ext, cnt] of Object.entries(techCount)) {
    techDist[ext] = Math.round((cnt / totalTech) * 100);
  }

  // Calculate cycle time for merged PRs
  const cycleTimes = pullRequests
    .filter(pr => pr.merged_at)
    .map(pr => {
      const created = new Date(pr.created_at);
      const merged = new Date(pr.merged_at);
      return (merged - created) / (1000 * 3600 * 24); // days
    });

  const avgCycle = cycleTimes.length
    ? (cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length).toFixed(1)
    : null;

  return {
    totalAdded,
    totalDeleted,
    commitsPerDay: dailyCount,
    techDistribution: techDist,
    prLinks: Array.from(prLinks),
    avgCycleTimeDays: avgCycle,
    totalPRs: pullRequests.length,
    totalIssues: issues.length,
    mergedPRs: pullRequests.filter(pr => pr.merged_at).length
  };
}

/**
 * Main service: fetch GitHub contributions, compute metrics, call LLM, cache & format.
 */
export async function createResumeSection({ repoUrl, repoId, userId, role, projectName, startDate, endDate }) {
  const cacheKey = `${userId}:${repoId}`;
  const cached = await ResumeCache.findOne({ cacheKey });
  if (cached && (Date.now() - cached.updatedAt) < 60 * 60 * 1000) {
    return cached.sectionText;
  }

  try {
    // 1. Get GitHub username from userId using Supabase
    const username = await getGitHubUsername(userId);
    
    // 2. Fetch contributions from GitHub API
    const contributions = await getGitHubContributions(repoUrl, username, startDate, endDate);

    // 3. Calculate metrics from GitHub data
    const metrics = calculateMetrics(contributions);

    // 4. Build AI prompt with contributions + metrics
    const prompt = buildPrompt(contributions.commits, metrics, { role, projectName, startDate, endDate });

    // 5. Call Python LLM microservice
    const { data } = await axios.post(
      `${process.env.PYTHON_BACKEND_URL}/resume`,
      { prompt }
    );
    const bullets = data.bullets;

    // 6. Format resume markdown/text
    const sectionText = formatResumeSection({ role, projectName, startDate, endDate, bullets });

    // 7. Cache result
    await ResumeCache.findOneAndUpdate(
      { cacheKey },
      { sectionText, updatedAt: Date.now() },
      { upsert: true }
    );

    return sectionText;

  } catch (error) {
    console.error('Error in createResumeSection:', error);
    throw error;
  }
}

/**
 * Helper function to get GitHub username from userId using Supabase
 */
async function getGitHubUsername(userId) {
  try {
    // Fetch user profile from Supabase
    const { data: user, error } = await supabase.auth.admin.getUserById(userId);
    
    if (error) {
      console.error('Error fetching user from Supabase:', error);
      throw new Error('Failed to fetch user profile');
    }

    if (!user) {
      throw new Error('User not found');
    }

    // Extract GitHub username from user metadata
    // When users sign in with GitHub OAuth, Supabase stores the username in user_metadata
    const githubUsername = user.user?.user_metadata?.user_name || 
                          user.user?.user_metadata?.preferred_username ||
                          user.user?.user_metadata?.login;

    if (!githubUsername) {
      throw new Error('GitHub username not found in user profile. Please ensure you signed in with GitHub.');
    }

    return githubUsername;

  } catch (error) {
    console.error('Error in getGitHubUsername:', error);
    throw new Error(`Failed to get GitHub username: ${error.message}`);
  }
} 