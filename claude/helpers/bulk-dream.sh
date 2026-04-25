#!/usr/bin/env bash
# bulk-dream.sh — Parse ALL historical sessions + run bulk dream worker
# No date limit (unlike run-dream-worker.sh --all which limits to 30 days)
# Progress logged to ~/.claude/learning/bulk-dream.log

set -euo pipefail

HOME_DIR="${HOME:-__HOME__}"
LEARNING="$HOME_DIR/.claude/learning"
SESSIONS="$LEARNING/sessions"
LOG="$LEARNING/bulk-dream.log"

mkdir -p "$SESSIONS"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === bulk-dream.sh started ===" | tee -a "$LOG"

# Step 1: Parse ALL sessions (no date limit, <5MB)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Step 1: Parsing all sessions..." | tee -a "$LOG"

python3 << 'PYEOF' 2>&1 | tee -a "$LOG"
import os, json, time, re
from pathlib import Path

home = Path.home()
projects_dir = home / '.claude' / 'projects'
sessions_dir = home / '.claude' / 'learning' / 'sessions'
sessions_dir.mkdir(parents=True, exist_ok=True)

MAX_SIZE = 5 * 1024 * 1024  # 5MB — no date limit

files = []
for f in projects_dir.glob('*/*.jsonl'):
    if 'subagents' in str(f): continue
    try:
        st = f.stat()
        if st.st_size <= MAX_SIZE:
            files.append((st.st_mtime, f))
    except: pass

files.sort(reverse=True)  # newest first for parse order
new_count = 0
skip_count = 0

for mtime, f in files:
    out_file = sessions_dir / f'{f.stem}.jsonl'
    if out_file.exists():
        skip_count += 1
        continue
    try:
        human_messages = []
        agents_run = []
        skills_read = set()
        seen_prompt_ids = set()
        with open(f, 'r', errors='ignore') as fp:
            for line in fp:
                line = line.strip()
                if not line: continue
                try: e = json.loads(line)
                except: continue
                if e.get('isSidechain', False): continue
                etype = e.get('type', '')
                msg = e.get('message', {}) or {}
                content = msg.get('content', [])
                if etype == 'user':
                    pid = e.get('promptId') or e.get('uuid', '')
                    if isinstance(content, str) and len(content) > 5 and pid not in seen_prompt_ids:
                        human_messages.append(content[:300]); seen_prompt_ids.add(pid)
                    elif isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get('type') == 'text':
                                t = (block.get('text') or '').strip()
                                if len(t) > 5 and pid not in seen_prompt_ids:
                                    human_messages.append(t[:300]); seen_prompt_ids.add(pid); break
                if etype == 'assistant' and isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict): continue
                        if block.get('type') == 'tool_use' and block.get('name') == 'Agent':
                            inp = block.get('input', {}) or {}
                            agents_run.append({'type': inp.get('subagent_type','unknown'), 'prompt_preview': (inp.get('prompt',''))[:150]})
                        if block.get('type') == 'tool_use' and block.get('name') == 'Read':
                            m = re.search(r'skills/([^/]+)/SKILL\.md', (block.get('input',{}) or {}).get('file_path',''), re.I)
                            if m: skills_read.add(m.group(1))
        if not human_messages: continue
        obs = {'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(mtime)), 'session_id': f.stem, 'human_messages': human_messages[:30], 'agents_run': agents_run[:10], 'skills_read': list(skills_read)}
        last_msg = human_messages[-1].lower() if human_messages else ''
        failure_signals = ['błąd', 'znowu', 'nie działa', 'nie dzia', 'fix', 'again', 'wrong', 'revert', 'crash', 'failed', 'cofnij', 'nie tak', 'kurwa', 'wyjebal', 'padl', 'broken']
        success_signals = ['działa', 'dziala', 'done', 'complete', 'works', 'pass', 'great', 'perfect', 'gotowe', 'super', 'spoko', 'ok dzieki', 'tak właśnie', 'tak wlasnie', 'o to chodzi']
        outcome = 'failure' if any(s in last_msg for s in failure_signals) else 'success' if any(s in last_msg for s in success_signals) else 'unknown'
        obs['outcome'] = outcome
        with open(out_file, 'w') as fp:
            json.dump(obs, fp); fp.write('\n')
        new_count += 1
        if new_count % 500 == 0:
            print(f"  ...parsed {new_count} so far (skipped {skip_count} existing)")
    except Exception as ex:
        pass

total = len(list(sessions_dir.glob('*.jsonl')))
print(f"Parse done. New: {new_count}, skipped (existing): {skip_count}, total in sessions/: {total}")
PYEOF

# Step 2: Run bulk dream runner
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Step 2: Running bulk dream runner..." | tee -a "$LOG"
node "$HOME_DIR/.claude/helpers/bulk-dream-runner.js" 2>&1 | tee -a "$LOG"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === bulk-dream.sh complete ===" | tee -a "$LOG"
PYEOF
