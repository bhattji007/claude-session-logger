#!/usr/bin/env node
'use strict';
// Background watcher that turns raw Claude Code transcripts (~/.claude/projects/**/*.jsonl)
// into a cross-machine, human-readable session history log.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const HOME = os.homedir();
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const LOG_DIR = path.join(HOME, '.claude-session-log');
const STATE_PATH = path.join(LOG_DIR, 'state.json');
const HISTORY_PATH = path.join(LOG_DIR, 'history.jsonl');
const SCRATCH_DIR = path.join(LOG_DIR, '.scratch');

const POLL_INTERVAL_MS = 60_000;
const IDLE_THRESHOLD_MS = 5 * 60_000; // a file must be untouched this long before we treat it as "episode ended"
const SUMMARY_MODEL = 'haiku';

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(SCRATCH_DIR, { recursive: true });

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

let state = loadState();

// Our own headless summarizer calls run with cwd=SCRATCH_DIR, which lives under a
// directory containing "claude-session-log" — exclude anything matching that so we
// never try to summarize our own summarization calls.
function isExcluded(filePath) {
  return filePath.includes('claude-session-log');
}

function listJsonlFiles() {
  const results = [];
  let projectDirs;
  try { projectDirs = fs.readdirSync(PROJECTS_DIR); } catch { return results; }
  for (const dir of projectDirs) {
    const full = path.join(PROJECTS_DIR, dir);
    if (isExcluded(full)) continue;
    let files;
    try { files = fs.readdirSync(full); } catch { continue; }
    for (const f of files) {
      if (f.endsWith('.jsonl')) results.push(path.join(full, f));
    }
  }
  return results;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

function extractDigest(lines) {
  const userTexts = [];
  const assistantTexts = [];
  const filesTouched = new Set();
  const commands = [];
  let cwd = null, sessionId = null, gitBranch = null;
  let firstTs = null, lastTs = null;

  for (const d of lines) {
    if (d.cwd) cwd = d.cwd;
    if (d.sessionId) sessionId = d.sessionId;
    if (d.gitBranch) gitBranch = d.gitBranch;
    if (d.timestamp) {
      if (!firstTs) firstTs = d.timestamp;
      lastTs = d.timestamp;
    }
    if (d.type === 'user' || d.type === 'assistant') {
      const content = d.message && d.message.content;
      if (typeof content === 'string') {
        (d.type === 'user' ? userTexts : assistantTexts).push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            (d.type === 'user' ? userTexts : assistantTexts).push(block.text);
          } else if (block.type === 'tool_use') {
            const input = block.input || {};
            if (input.file_path) filesTouched.add(input.file_path);
            if (block.name === 'Bash' && input.command) commands.push(input.command);
          }
        }
      }
    }
  }
  return { userTexts, assistantTexts, filesTouched: [...filesTouched], commands, cwd, sessionId, gitBranch, firstTs, lastTs };
}

function buildPrompt(digest) {
  const parts = [];
  parts.push('Summarize this Claude Code session excerpt in 2-3 plain sentences: what the user asked for and what was actually done. No preamble, no markdown, just the summary.');
  parts.push('--- USER MESSAGES ---');
  parts.push(digest.userTexts.map(t => truncate(t, 500)).join('\n---\n') || '(none)');
  parts.push('--- ASSISTANT MESSAGES ---');
  parts.push(digest.assistantTexts.map(t => truncate(t, 500)).join('\n---\n') || '(none)');
  if (digest.filesTouched.length) {
    parts.push('--- FILES TOUCHED ---');
    parts.push(digest.filesTouched.join('\n'));
  }
  if (digest.commands.length) {
    parts.push('--- COMMANDS RUN ---');
    parts.push(digest.commands.slice(0, 20).map(c => truncate(c, 200)).join('\n'));
  }
  return parts.join('\n');
}

function summarize(prompt) {
  return new Promise((resolve) => {
    const child = spawn('claude', [
      '-p', prompt,
      '--model', SUMMARY_MODEL,
      '--output-format', 'text',
      '--setting-sources', '',
    ], { cwd: SCRATCH_DIR });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (code !== 0) {
        log(`summarize failed (code ${code}): ${err.slice(0, 300)}`);
        resolve(null);
      } else {
        resolve(out.trim());
      }
    });
    child.on('error', (e) => { log(`summarize spawn error: ${e.message}`); resolve(null); });
  });
}

function appendHistory(entry) {
  fs.appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n');
}

async function processFile(filePath) {
  const st = state[filePath] || { offset: 0 };
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return; }
  if (content.length <= st.offset) return;

  const newContent = content.slice(st.offset);
  const lines = newContent.split('\n').filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try { parsed.push(JSON.parse(line)); } catch { /* skip partial/malformed trailing line */ }
  }
  if (!parsed.length) return;

  const digest = extractDigest(parsed);
  if (!digest.userTexts.length && !digest.assistantTexts.length) {
    state[filePath] = { offset: content.length };
    saveState(state);
    return;
  }

  const summary = await summarize(buildPrompt(digest));
  if (summary === null) return; // leave offset alone, retry next tick

  appendHistory({
    date: (digest.lastTs || new Date().toISOString()).slice(0, 10),
    time_start: digest.firstTs,
    time_end: digest.lastTs,
    session_id: digest.sessionId,
    project_cwd: digest.cwd,
    git_branch: digest.gitBranch,
    files_touched: digest.filesTouched,
    summary,
    transcript_path: filePath,
  });
  log(`logged episode: ${digest.cwd} :: ${summary.slice(0, 80)}`);

  state[filePath] = { offset: content.length };
  saveState(state);
}

async function tick() {
  const files = listJsonlFiles();
  const now = Date.now();
  for (const filePath of files) {
    let mtime;
    try { mtime = fs.statSync(filePath).mtimeMs; } catch { continue; }
    if (now - mtime < IDLE_THRESHOLD_MS) continue; // still active, wait for it to go idle
    await processFile(filePath);
  }
}

function seedBaseline() {
  const files = listJsonlFiles();
  for (const filePath of files) {
    if (state[filePath]) continue;
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch { /* file disappeared */ }
    state[filePath] = { offset: size };
  }
  saveState(state);
}

log('claude-session-logger starting');
if (Object.keys(state).length === 0) {
  log('first run — seeding baseline, existing history will not be retroactively summarized');
  seedBaseline();
}

setInterval(() => { tick().catch(e => log(`tick error: ${e.message}`)); }, POLL_INTERVAL_MS);
tick().catch(e => log(`tick error: ${e.message}`));
