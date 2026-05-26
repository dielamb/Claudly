#!/usr/bin/env bash
# Run Dream Worker manually — bypasses 4h cooldown
# Usage:
#   run-dream-worker.sh          — run on existing sessions
#   run-dream-worker.sh --all    — re-parse recent transcripts first, then run

set -euo pipefail

HOME_DIR="${HOME:-__HOME__}"
LEARNING="$HOME_DIR/.claude/learning"

if [[ "${1:-}" == "--all" ]]; then
  echo "Parsing recent session transcripts (last 30 days, <5MB)..."
  python3 << 'PYEOF'
import os, json, time, re
from pathlib import Path

home = Path.home()
projects_dir = home / '.claude' / 'projects'
sessions_dir = home / '.claude' / 'learning' / 'sessions'
sessions_dir.mkdir(parents=True, exist_ok=True)

THIRTY_DAYS = 30 * 24 * 3600
MAX_SIZE = 5 * 1024 * 1024
now = time.time()

files = []
for f in projects_dir.glob('*/*.jsonl'):
    if 'subagents' in str(f): continue
    try:
        st = f.stat()
        if (now - st.st_mtime) <= THIRTY_DAYS and st.st_size <= MAX_SIZE:
            files.append((st.st_mtime, f))
    except: pass

files.sort(reverse=True)
new_count = 0

for mtime, f in files:
    out_file = sessions_dir / f'{f.stem}.jsonl'
    if out_file.exists(): continue
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
        with open(out_file, 'w') as fp:
            json.dump(obs, fp); fp.write('\n')
        new_count += 1
    except: pass

print(f"Parsed {new_count} new sessions. Total: {len(list(sessions_dir.glob('*.jsonl')))}")
PYEOF
fi

# Reset 4h cooldown
echo "" > "$LEARNING/last-dream.txt"

echo "Running Dream Worker..."
node "$HOME_DIR/.claude/helpers/dream-worker.js" 2>&1
