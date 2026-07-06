# claude-session-logger

A tiny always-on macOS background service that watches every [Claude Code](https://claude.com/claude-code)
session on your machine — in any project, any directory — and builds a searchable, plain-language
history of what you actually did, with dates. Comes with a `/recall` skill so you can query that
history from inside any Claude Code session.

## How it works

Claude Code already writes a full transcript for every session to
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, machine-wide. This tool doesn't hook into
anything — it just watches those files:

1. A background daemon (`daemon.js`, run via `launchd`) polls `~/.claude/projects/**/*.jsonl` every
   60 seconds.
2. When a session file has gone quiet for 5 minutes (i.e. the episode looks finished), it pulls the
   new user/assistant messages, files touched, and commands run since the last check.
3. It sends that digest to a headless `claude -p --model haiku` call (using your existing Claude
   Code login — no separate API key needed) to get a 2-3 sentence summary.
4. It appends one JSON record to `~/.claude-session-log/history.jsonl`: date, time range, project
   path, git branch, files touched, and the summary.

The daemon excludes its own summarization calls from being watched (no recursive loop), and never
touches or uploads anything beyond the same Anthropic API calls Claude Code already makes on your
behalf.

## Requirements

- macOS (uses `launchd`; adapt `daemon.js` to systemd/cron for Linux/other)
- Node.js on `PATH`
- Claude Code CLI installed and logged in on `PATH`

## Install

```bash
git clone https://github.com/<you>/claude-session-logger.git
cd claude-session-logger
./install.sh
```

This copies `daemon.js` to `~/.claude-session-log/`, installs the `/recall` skill to
`~/.claude/skills/session-history/`, generates a `launchd` plist with paths detected for your
machine, and starts the service.

## Usage

Inside any Claude Code session, anywhere on your machine:

```
/recall                 # recap of recent activity across all projects
/recall yesterday
/recall <project-name>  # sessions in a specific project/repo
/recall <keyword>       # keyword search across summaries
```

Or query the log directly:

```bash
tail -n 20 ~/.claude-session-log/history.jsonl | jq .
jq -c 'select(.date=="2026-07-06")' ~/.claude-session-log/history.jsonl
jq -c 'select(.project_cwd | test("my-repo"))' ~/.claude-session-log/history.jsonl
```

## Uninstall

```bash
./uninstall.sh
```

Stops and unloads the daemon. Your accumulated history and the skill are left on disk — delete
`~/.claude-session-log` and `~/.claude/skills/session-history` manually if you want them gone too.

## Limitations

- macOS only as shipped (launchd).
- No retroactive backlog — only sessions that go idle *after* install are logged.
- ~5 minute lag before a finished session shows up (idle-detection window).
- Each summarized episode costs one small `haiku` call against your Claude Code usage.
- Everything stays local; `history.jsonl` can contain sensitive project details, so treat it like
  any other local log — it is not included in this repo and should never be committed.

## License

MIT
