---
name: session-history
description: Query the cross-machine Claude Code session history log at ~/.claude-session-log/history.jsonl — what was worked on, when, and in which project, with short LLM-written summaries per session. Use whenever the user asks what they did on a given day, wants a recap of recent Claude Code activity, asks about work on a specific project/repo, or references "what did I do in that session."
trigger: /recall
---

# /recall — Claude Code session history

A background daemon (`com.bhattji.claude-session-logger`, see `~/.claude-session-log/daemon.js`)
watches every Claude Code transcript on this machine (`~/.claude/projects/**/*.jsonl`) and, once a
session goes idle, appends one summarized record to:

```
~/.claude-session-log/history.jsonl
```

Each line is a JSON object:

```json
{
  "date": "2026-07-06",
  "time_start": "2026-07-06T06:55:32.227Z",
  "time_end": "2026-07-06T07:40:11.001Z",
  "session_id": "f3614bc3-...",
  "project_cwd": "/Users/bhattji/Desktop",
  "git_branch": "main",
  "files_touched": ["/Users/bhattji/.claude-session-log/daemon.js"],
  "summary": "2-3 sentence plain-language recap of what was asked and what was done.",
  "transcript_path": "/Users/bhattji/.claude/projects/-Users-bhattji-Desktop/f3614bc3-....jsonl"
}
```

## How to answer a query

1. Read `~/.claude-session-log/history.jsonl`. If it doesn't exist or is empty, say so plainly —
   don't invent history. Also mention the daemon may not have run yet (episodes only get logged
   ~5 minutes after a session goes idle) or may be down (`launchctl list | grep claude-session-logger`
   to check).
2. Filter with `jq` based on what was asked, then synthesize a readable answer — don't just dump
   raw JSON at the user unless they ask for raw data. Group by date/project, sort chronologically,
   lead with the summary sentence, and include the time range and project path.

Useful filter templates:

```bash
# everything from a specific date
jq -c 'select(.date=="2026-07-06")' ~/.claude-session-log/history.jsonl

# everything in a given project/repo (path substring match)
jq -c 'select(.project_cwd | test("tm-reco-app"))' ~/.claude-session-log/history.jsonl

# last N entries overall, most recent last
tail -n 20 ~/.claude-session-log/history.jsonl | jq -c .

# keyword search across summaries
jq -c 'select(.summary | test("migration"; "i"))' ~/.claude-session-log/history.jsonl

# a date range
jq -c 'select(.date >= "2026-07-01" and .date <= "2026-07-06")' ~/.claude-session-log/history.jsonl
```

3. If the user wants more detail than the summary gives (e.g. "what exactly did I change"), open
   the `transcript_path` for that record and read the relevant portion rather than re-summarizing
   from scratch.
4. Note the coverage gap: only sessions that went idle *after* the daemon was installed
   (2026-07-06) are logged — there's no retroactive history from before that, and the current
   in-progress session (if any) won't show up until it's been idle ~5 minutes.

## Usage

```
/recall                                  # recap of recent activity across all projects
/recall today                            # what happened today
/recall yesterday
/recall tm-reco-app                      # sessions in a specific project
/recall last week
/recall migration                        # keyword search across summaries
```

The skill also triggers implicitly on natural questions like "what did I work on yesterday?" or
"what have I been doing on the reco app this week?" — no need to type `/recall` explicitly.
