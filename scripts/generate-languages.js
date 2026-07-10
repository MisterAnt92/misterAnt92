#!/usr/bin/env node
/**
 * generate-languages.js
 *
 * Fetches language statistics from the GitHub API for all non-fork repositories
 * owned by OWNER, aggregates byte counts per language, computes percentages,
 * and writes a self-contained SVG bar chart to OUTPUT_PATH.
 *
 * Required environment variable:
 *   GITHUB_TOKEN  – a token with at least public_repo read access.
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Configuration ────────────────────────────────────────────────────────────

const OWNER       = 'MisterAnt92';
const OUTPUT_PATH = path.join(__dirname, '..', 'assets', 'languages.svg');
const MAX_LANGS   = 8;   // maximum bars to render in the chart

// Subset of GitHub's canonical language colours.
// Add or override entries here to customise the chart colours.
const LANG_COLORS = {
  'JavaScript':      '#f1e05a',
  'TypeScript':      '#3178c6',
  'Python':          '#3572A5',
  'Java':            '#b07219',
  'Kotlin':          '#A97BFF',
  'Swift':           '#F05138',
  'C':               '#555555',
  'C++':             '#f34b7d',
  'C#':              '#178600',
  'Go':              '#00ADD8',
  'Rust':            '#dea584',
  'Ruby':            '#701516',
  'PHP':             '#4F5D95',
  'HTML':            '#e34c26',
  'CSS':             '#563d7c',
  'Shell':           '#89e051',
  'Dart':            '#00B4AB',
  'Scala':           '#c22d40',
  'Groovy':          '#4298b8',
  'Makefile':        '#427819',
  'Objective-C':     '#438eff',
  'R':               '#198CE7',
  'Vue':             '#41b883',
  'SCSS':            '#c6538c',
  'Jupyter Notebook':'#DA5B0B',
};

function langColor(name) {
  return LANG_COLORS[name] || '#858585';
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * Performs a GET request and resolves with the parsed JSON body.
 * Follows the GitHub pagination Link header automatically when `collect` is
 * true (used for repo listing).
 */
function get(url, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent':    'language-chart-generator/1.0',
        'Authorization': `token ${token}`,
        'Accept':        'application/vnd.github.v3+json',
      },
    };
    https.get(url, opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ body: JSON.parse(raw), headers: res.headers });
          } catch (e) {
            reject(new Error(`JSON parse error for ${url}: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} for ${url}: ${raw.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

// ── GitHub API calls ──────────────────────────────────────────────────────────

/** Returns all non-fork repos owned by OWNER (handles pagination). */
async function fetchRepos(token) {
  const repos = [];
  let url = `https://api.github.com/users/${OWNER}/repos?per_page=100&type=owner`;

  while (url) {
    const { body, headers } = await get(url, token);
    // body should be an array; guard against unexpected responses
    if (!Array.isArray(body)) break;
    repos.push(...body.filter((r) => !r.fork));

    // Follow the `next` link if present
    const link = headers['link'] || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  return repos;
}

/**
 * Returns the language map `{ Language: bytes }` for a single repo.
 * Returns an empty object on error (e.g. empty / inaccessible repo).
 */
async function fetchLanguages(repoName, token) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${repoName}/languages`;
    const { body } = await get(url, token);
    return typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

// ── SVG generation ────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds an SVG string from the aggregated language totals.
 * Returns null when totals is empty.
 */
function buildSvg(totals) {
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const entries = Object.entries(totals)
    .map(([name, bytes]) => ({ name, bytes, pct: (bytes / total) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_LANGS);

  // Layout constants (all in px)
  const W          = 400;
  const PAD        = 16;
  const LABEL_W    = 110;
  const PCT_W      = 46;
  const BAR_H      = 8;
  const ROW_H      = 28;
  const TITLE_H    = 42;
  const BAR_AREA   = W - PAD * 2 - LABEL_W - PCT_W;
  const H          = TITLE_H + entries.length * ROW_H + PAD;

  const rows = entries.map(({ name, pct }, i) => {
    const rowY  = TITLE_H + i * ROW_H;
    const textY = rowY + ROW_H / 2 + 4;   // vertical centre of text baseline
    const barY  = rowY + (ROW_H - BAR_H) / 2;
    const barW  = Math.max(2, (pct / 100) * BAR_AREA);
    const color = langColor(name);
    const barX  = PAD + LABEL_W;

    return [
      `  <text x="${PAD}" y="${textY}" fill="#cdd6f4" font-size="12"`,
      `        font-family="'Segoe UI',Helvetica,Arial,sans-serif">${escapeXml(name)}</text>`,
      `  <rect x="${barX}" y="${barY}" width="${barW.toFixed(1)}" height="${BAR_H}"`,
      `        rx="4" fill="${color}" opacity="0.9"/>`,
      `  <text x="${W - PAD - PCT_W + 4}" y="${textY}" fill="#a6adc8" font-size="11"`,
      `        font-family="'Segoe UI',Helvetica,Arial,sans-serif">${pct.toFixed(1)}%</text>`,
    ].join('\n');
  }).join('\n');

  return [
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`,
    `     xmlns="http://www.w3.org/2000/svg"`,
    `     role="img" aria-label="Languages chart">`,
    `  <title>Languages chart</title>`,
    `  <rect width="${W}" height="${H}" rx="10" fill="#1e1e2e"/>`,
    `  <text x="${PAD}" y="28" fill="#cdd6f4" font-size="15" font-weight="bold"`,
    `        font-family="'Segoe UI',Helvetica,Arial,sans-serif">&#x1F5C2; Languages</text>`,
    rows,
    `</svg>`,
  ].join('\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN environment variable is not set.');
    process.exit(1);
  }

  console.log(`Fetching repositories for ${OWNER}…`);
  const repos = await fetchRepos(token);
  console.log(`Found ${repos.length} non-fork repositories.`);

  const totals = {};
  for (const repo of repos) {
    process.stdout.write(`  ${repo.name} … `);
    const langs = await fetchLanguages(repo.name, token);
    const keys  = Object.keys(langs);
    console.log(keys.length ? keys.join(', ') : '(empty)');
    for (const [lang, bytes] of Object.entries(langs)) {
      totals[lang] = (totals[lang] || 0) + bytes;
    }
  }

  const svg = buildSvg(totals);
  if (!svg) {
    console.error('No language data found across all repositories.');
    process.exit(1);
  }

  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUTPUT_PATH, svg, 'utf8');
  console.log(`\nSVG chart written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
