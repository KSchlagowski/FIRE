---
name: push
description: Run the full git add → git commit → git push flow correctly, avoiding shell-quoting bugs. Use when the user asks to push, commit and push, save/ship changes, or "git push" — especially on Windows where the Bash tool runs POSIX sh (Git Bash), not PowerShell, so PowerShell here-string syntax (@'...'@) must never be used in commit messages.
---

# push — add, commit & push without mangling the message

Goal: run the full **`git add` → `git commit` → `git push`** flow, landing a clean
commit and pushing it, **without** the classic Windows mistake of leaking PowerShell
here-string markers (`@'` / `'@`) into the commit message.

Unless the user says otherwise, always do all three steps: stage the changes,
commit them, then push.

## The bug this skill prevents

On this machine the **Bash tool runs Git Bash (POSIX sh)**, but the shell *looks*
like Windows so it's tempting to reach for PowerShell here-strings:

```bash
# WRONG — @'...'@ is PowerShell syntax; POSIX sh keeps the @ literally,
# so the commit message starts with a stray "@" line.
git commit -m @'
My message
'@
```

The result is a mangled message like the one that has to be fixed with `--amend`.
Don't do that. Use one of the safe methods below.

## Safe workflow

Run these with the **Bash tool** (POSIX sh). Do the steps in order.

### 1. Inspect first

```bash
git status
git diff --stat
git branch --show-current
```

- If on `main`, that's expected for this repo (default branch is `main`).
- Only stage/commit if the user asked you to — if there's already a clean tree and
  they just said "push", skip straight to step 4.

### 2. Stage

```bash
git add -A          # or name specific paths the user meant
```

### 3. Commit — pick ONE quoting method that works in POSIX sh

**Method A — single `-m` (best for one-line messages).** Single-quote it:

```bash
git commit -m 'feat: krótki opis zmiany (v1.14.0)'
```

**Method B — POSIX heredoc via a file (best for multi-line / body).** This is the
correct replacement for a PowerShell here-string:

```bash
cat > /tmp/commitmsg.txt <<'EOF'
feat: tytuł commita po polsku

Dłuższy opis w kolejnych liniach.
Znaki $ i ` są tu literalne dzięki cudzysłowom wokół EOF.
EOF
git commit -F /tmp/commitmsg.txt
rm -f /tmp/commitmsg.txt
```

Notes:
- Quote the heredoc delimiter (`<<'EOF'`) so `$`, backticks, and `!` stay literal.
- **Never** use `@'...'@` — that is PowerShell only.
- Repeated `-m` flags also work for a title+body: `git commit -m 'title' -m 'body'`.

Commit-message conventions for **this repo**: messages are **in Polish** to match
history (see `git log`), and releases bump the version in three places — if this is
a release, follow the checklist in `CLAUDE.md` / `README.md` before committing.

### 4. Push

```bash
git push
```

If the branch has no upstream yet:

```bash
git push -u origin "$(git branch --show-current)"
```

### 5. Confirm

```bash
git log --oneline -1
git status
```

Report the pushed commit hash + message to the user. If the push is rejected
(non-fast-forward), stop and tell the user — do **not** force-push unless they
explicitly ask.

## Guardrails

- Never `--force` / `--force-with-lease` unless the user explicitly requests it.
- Never `--no-verify` (skip hooks) unless the user explicitly requests it.
- Don't amend an already-pushed commit; prefer a new commit.
- If you must reach for PowerShell for something else, remember the PowerShell tool
  and the Bash tool are **different shells** — don't mix their quoting syntax.
