#!/usr/bin/env node
// Regenerates the "Open-source contributions" list in README.md between the
// <!-- CONTRIBUTIONS:START --> / <!-- CONTRIBUTIONS:END --> markers.
//
// Lists public repositories I've had pull requests MERGED into but don't own.
// Uses the GitHub public API. In CI the workflow's built-in GITHUB_TOKEN is
// passed for rate limits; because that token only sees public data, private
// repos can never appear. Runs unauthenticated locally too.

import { readFileSync, writeFileSync } from 'node:fs'

const USER = process.env.GH_USERNAME || 'upuddu'
const TOKEN = process.env.GITHUB_TOKEN || ''
const README = new URL('../README.md', import.meta.url)
const START = '<!-- CONTRIBUTIONS:START -->'
const END = '<!-- CONTRIBUTIONS:END -->'

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': `${USER}-profile-readme`,
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`)
  return res.json()
}

function repoFullName(repositoryUrl) {
  const parts = repositoryUrl.split('/repos/')
  return parts.length === 2 && parts[1] ? parts[1] : null
}

function formatStars(n) {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

async function collect() {
  const q = encodeURIComponent(`type:pr author:${USER} is:merged`)
  const search = await gh(`/search/issues?q=${q}&per_page=100`)
  const u = USER.toLowerCase()

  const counts = new Map()
  for (const item of search.items ?? []) {
    const full = repoFullName(item.repository_url)
    if (!full || full.split('/')[0].toLowerCase() === u) continue
    counts.set(full, (counts.get(full) ?? 0) + 1)
  }

  const rows = []
  for (const [full, count] of counts) {
    let detail
    try {
      detail = await gh(`/repos/${full}`)
    } catch {
      continue // not publicly available → skip
    }
    if (detail.private || detail.owner.login.toLowerCase() === u) continue
    rows.push({
      full: detail.full_name,
      url: detail.html_url,
      description: detail.description || '',
      stars: detail.stargazers_count,
      language: detail.language,
      count,
      prsUrl: `${detail.html_url}/pulls?q=${encodeURIComponent(`is:pr author:${USER} is:merged`)}`,
    })
  }
  return rows.sort((a, b) => b.stars - a.stars)
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

function render(rows) {
  if (rows.length === 0) return '_Nothing to show yet._'
  const header = '| Project | What it does | Language | Stars | Merged |\n| :-- | :-- | :-- | --: | :--: |'
  const body = rows
    .map((r) => {
      const desc = truncate(r.description, 80).replace(/\|/g, '\\|') || '—'
      const lang = r.language || '—'
      const prs = `[${r.count} PR${r.count === 1 ? '' : 's'}](${r.prsUrl})`
      return `| **[${r.full}](${r.url})** | ${desc} | ${lang} | ${formatStars(r.stars)} | ${prs} |`
    })
    .join('\n')
  return `${header}\n${body}`
}

const rows = await collect()
const block = `${START}\n\n${render(rows)}\n\n${END}`
const md = readFileSync(README, 'utf8')

if (!md.includes(START) || !md.includes(END)) {
  throw new Error('CONTRIBUTIONS markers not found in README.md')
}
const next = md.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
writeFileSync(README, next)
console.log(`Updated ${rows.length} contribution(s).`)
