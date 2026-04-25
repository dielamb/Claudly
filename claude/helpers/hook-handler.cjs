#!/usr/bin/env node
/**
 * Claude Flow Hook Handler (Cross-Platform)
 * Dispatches hook events to the appropriate helper modules.
 *
 * Usage: node hook-handler.cjs <command> [args...]
 *
 * Commands:
 *   route          - Route a task to optimal agent (reads PROMPT from env/stdin)
 *   pre-bash       - Validate command safety before execution
 *   post-edit      - Record edit outcome for learning
 *   session-restore - Restore previous session state
 *   session-end    - End session and persist state
 */

const path = require('path');
const fs = require('fs');

const helpersDir = __dirname;

// Safe require with stdout suppression - the helper modules have CLI
// sections that run unconditionally on require(), so we mute console
// during the require to prevent noisy output.
function safeRequire(modulePath) {
  try {
    if (fs.existsSync(modulePath)) {
      const origLog = console.log;
      const origError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        const mod = require(modulePath);
        return mod;
      } finally {
        console.log = origLog;
        console.error = origError;
      }
    }
  } catch (e) {
    // silently fail
  }
  return null;
}

const router = safeRequire(path.join(helpersDir, 'router.js'));
const session = safeRequire(path.join(helpersDir, 'session.js'));
const memory = safeRequire(path.join(helpersDir, 'memory.js'));
const intelligence = safeRequire(path.join(helpersDir, 'intelligence.cjs'));

// Get the command from argv
const [,, command, ...args] = process.argv;

// Read stdin with timeout — Claude Code sends hook data as JSON via stdin.
// Timeout prevents hanging when stdin is not properly closed (common on Windows).
async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(data);
    }, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
    process.stdin.resume();
  });
}

async function main() {
  let stdinData = '';
  try { stdinData = await readStdin(); } catch (e) { /* ignore stdin errors */ }

  let hookInput = {};
  if (stdinData.trim()) {
    try { hookInput = JSON.parse(stdinData); } catch (e) { /* ignore parse errors */ }
  }

  // Merge stdin data into prompt resolution: prefer stdin fields, then env, then argv
  const prompt = hookInput.prompt || hookInput.command || hookInput.toolInput
    || process.env.PROMPT || process.env.TOOL_INPUT_command || args.join(' ') || '';

const handlers = {
  'route': () => {
    // Detect negative signals → decay last-matched patterns + mark router failure
    if (intelligence && intelligence.detectNegativeSignal && intelligence.detectNegativeSignal(prompt)) {
      try {
        intelligence.negativeFeedback(prompt);
        if (router && router.markLastRoutingOutcome) router.markLastRoutingOutcome(false);
        console.log('[FEEDBACK] Negative signal detected — decaying patterns, marking routing failure');
      } catch (e) { /* non-fatal */ }
    }

    // Inject ranked intelligence context before routing
    if (intelligence && intelligence.getContext) {
      try {
        const ctx = intelligence.getContext(prompt);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }

    if (router && router.routeTask) {
      const startTime = Date.now();
      const result = router.routeTask(prompt);
      const latency = Date.now() - startTime;

      const line = `[INFO] Routing task: ${prompt.substring(0, 60) || '(no prompt)'}\n\nRouting: ${result.agent} (${(result.confidence * 100).toFixed(0)}%) — ${result.reason.substring(0, 50)}`;
      console.log(line);
    } else {
      console.log('[INFO] Router not available, using default routing');
    }
  },

  'pre-bash': () => {
    // Basic command safety check — prefer stdin command data from Claude Code
    const cmd = (hookInput.command || prompt).toLowerCase();
    const dangerous = ['rm -rf /', 'format c:', 'del /s /q c:\\', ':(){:|:&};:'];
    for (const d of dangerous) {
      if (cmd.includes(d)) {
        console.error(`[BLOCKED] Dangerous command detected: ${d}`);
        process.exit(1);
      }
    }
  },

  'pre-edit': () => {
    // Intelligence context BEFORE editing — show relevant patterns/warnings
    const file = hookInput.file_path || (hookInput.toolInput && hookInput.toolInput.file_path)
      || process.env.TOOL_INPUT_file_path || args[0] || '';
    // Build richer query from file path + edit content for better pattern matching
    const ti = hookInput.toolInput || hookInput || {};
    const editSnippet = (ti.old_string || '').substring(0, 200) + ' ' + (ti.new_string || '').substring(0, 200);
    const query = [file, editSnippet].filter(s => s && s.trim()).join(' ');
    if (intelligence && intelligence.getContext && query) {
      try {
        const ctx = intelligence.getContext(query);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }
  },

  'post-edit': () => {
    // Record edit for session metrics
    if (session && session.metric) {
      try { session.metric('edits'); } catch (e) { /* no active session */ }
    }
    // Record edit for intelligence consolidation — prefer stdin data from Claude Code
    if (intelligence && intelligence.recordEdit) {
      try {
        const file = hookInput.file_path || (hookInput.toolInput && hookInput.toolInput.file_path)
          || process.env.TOOL_INPUT_file_path || args[0] || '';
        intelligence.recordEdit(file);
      } catch (e) { /* non-fatal */ }
    }
  },

  'session-restore': () => {
    // Check if previous session needs braindump
    try {
      const cpPath = path.join(process.env.HOME || '', '.claude', 'last-session.json');
      if (fs.existsSync(cpPath)) {
        const cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
        if (cp.needsBraindump) {
          console.log(`[BRAINDUMP] Previous session (${cp.date}) not summarized. Run /tldr to capture lessons learned.`);
          cp.needsBraindump = false;
          fs.writeFileSync(cpPath, JSON.stringify(cp, null, 2));
        }
      }
    } catch (e) { /* non-fatal */ }
    // Load Obsidian context via ruflo-session-loader and merge into intelligence store
    try {
      const loaderPath = path.join(helpersDir, 'ruflo-session-loader.cjs');
      if (fs.existsSync(loaderPath)) {
        const { execSync } = require('child_process');
        const output = execSync(`node "${loaderPath}"`, { timeout: 5000, encoding: 'utf8' });
        const data = JSON.parse(output);
        if (data.patternsLoaded > 0 && data.patterns && data.patterns.length > 0) {
          // Merge Obsidian patterns into auto-memory-store.json so intelligence.init() sees them
          // Global store at ~/.claude-flow/data/ — matches intelligence.cjs DATA_DIR
          const storeDir = path.join(process.env.HOME || '', '.claude-flow', 'data');
          const storePath = path.join(storeDir, 'auto-memory-store.json');
          try { fs.mkdirSync(storeDir, { recursive: true }); } catch (_) {}
          let store = [];
          try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch (_) {}
          // Replace basic ruflo-session-loader entries but preserve obsidian-extended-loader entries
          store = store.filter(e => !e.metadata?.fromObsidian || e.metadata?.extendedLoader);
          for (const p of data.patterns) {
            const id = 'obs-' + (p.metadata?.file || p.metadata?.category || '').replace(/[^a-z0-9]/gi, '-').substring(0, 40);
            store.push({
              id,
              key: id,
              content: p.pattern,
              summary: p.type === 'rule-proven' ? 'Obsidian proven pattern' : p.type === 'rule' ? 'Obsidian problem pattern' : 'Obsidian context',
              namespace: p.type === 'rule-proven' ? 'rules-proven' : p.type === 'rule' ? 'rules' : 'context',
              type: p.type === 'rule-proven' ? 'procedural' : p.type === 'rule' ? 'procedural' : 'semantic',
              metadata: { ...p.metadata, fromObsidian: true },
              createdAt: Date.now()
            });
          }
          fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
          console.log(`[OBSIDIAN] Loaded ${data.patternsLoaded} context items (${data.sources.efforts} efforts, ${data.sources.problems} problems)`);
        }
      }
    } catch (e) { /* non-fatal - loader is optional */ }
    if (session) {
      // Try restore first, fall back to start
      const existing = session.restore && session.restore();
      if (!existing) {
        session.start && session.start();
      }
    }
    // Initialize intelligence graph after session restore
    if (intelligence && intelligence.init) {
      try {
        const result = intelligence.init();
        if (result && result.nodes > 0) {
          console.log(`[INTELLIGENCE] Loaded ${result.nodes} patterns, ${result.edges} edges`);
        }
      } catch (e) { /* non-fatal */ }
    }
  },

  'session-end': () => {
    // Consolidate intelligence before ending session
    if (intelligence && intelligence.consolidate) {
      try {
        const result = intelligence.consolidate();
        if (result && result.entries > 0) {
          console.log(`[INTELLIGENCE] Consolidated: ${result.entries} entries, ${result.edges} edges${result.newEntries > 0 ? `, ${result.newEntries} new` : ''}, PageRank recomputed`);
        }
      } catch (e) { /* non-fatal */ }
    }
    // Run auto-tldr in background (headless Claude summarizes session)
    try {
      const tldrScript = path.join(helpersDir, 'auto-tldr.sh');
      if (fs.existsSync(tldrScript)) {
        const { spawn } = require('child_process');
        spawn('bash', [tldrScript], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch (e) { /* non-fatal */ }
    // Write braindump checkpoint for next session (fallback if auto-tldr fails)
    try {
      const checkpoint = {
        timestamp: new Date().toISOString(),
        date: new Date().toISOString().split('T')[0],
        needsBraindump: true
      };
      const cpPath = path.join(process.env.HOME || '', '.claude', 'last-session.json');
      fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));
    } catch (e) { /* non-fatal */ }

    // ── Dream Worker: capture raw session observation to JSONL ────────────
    // Reads actual transcript file (transcript_path from hook event).
    // Saves structured observation: human_messages + agents_run + skills_read.
    // Dream Worker interprets corrections — we just capture raw signal.
    try {
      const sessionId = hookInput.session_id
        || process.env.CLAUDE_SESSION_ID
        || `session-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

      const transcriptPath = hookInput.transcript_path;
      let observation = null;

      if (transcriptPath && fs.existsSync(transcriptPath)) {
        // Parse actual JSONL transcript file (article approach — most accurate)
        const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
        const humanMessages = [];
        const agentsRun = [];
        const skillsRead = new Set();
        let pendingAgent = null;

        for (const line of lines) {
          let e; try { e = JSON.parse(line); } catch { continue; }
          const role = e.message?.role;
          const content = e.message?.content;
          if (!Array.isArray(content)) continue;

          for (const block of content) {
            if (role === 'user' && block.type === 'text') {
              const text = (block.text || '').trim();
              if (text.length > 2) humanMessages.push(text.slice(0, 300));
            }
            if (role === 'user' && block.type === 'tool_result' && pendingAgent) {
              const parts = Array.isArray(block.content)
                ? block.content : [{ type: 'text', text: String(block.content || '') }];
              const output = parts.filter(p => p.type === 'text' && p.text)
                .map(p => p.text).join('\n').trim();
              agentsRun.push({
                type: pendingAgent.type,
                prompt_preview: pendingAgent.prompt,
                output_preview: output.slice(0, 400).replace(/\s+/g, ' ')
              });
              pendingAgent = null;
            }
            if (role === 'assistant' && block.type === 'tool_use') {
              if (block.name === 'Agent') {
                const t = (block.input?.subagent_type || 'unknown')
                  .replace(/^[^:]+:/, '').toLowerCase();
                pendingAgent = { type: t, prompt: (block.input?.prompt || '').slice(0, 150) };
              }
              if (block.name === 'Read') {
                const m = (block.input?.file_path || '').match(/skills\/([^/]+)\/SKILL\.md$/i);
                if (m) skillsRead.add(m[1]);
              }
            }
          }
        }

        if (humanMessages.length > 0) {
          observation = {
            ts: new Date().toISOString(),
            session_id: sessionId,
            human_messages: humanMessages,
            agents_run: agentsRun,
            skills_read: [...skillsRead]
          };
        }
      } else {
        // Fallback: hookInput may have inline messages (older Claude Code versions)
        const messages = hookInput.messages || hookInput.transcript || [];
        const humanMessages = messages
          .filter(m => m && (m.role === 'human' || m.role === 'user'))
          .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 300));
        if (humanMessages.length > 0) {
          observation = {
            ts: new Date().toISOString(),
            session_id: sessionId,
            human_messages: humanMessages,
            agents_run: [],
            skills_read: []
          };
        }
      }

      if (observation) {
        const sessionsDir = path.join(process.env.HOME || '', '.claude', 'learning', 'sessions');
        try { fs.mkdirSync(sessionsDir, { recursive: true }); } catch (_) {}
        const outPath = path.join(sessionsDir, `${sessionId}.jsonl`);
        fs.writeFileSync(outPath, JSON.stringify(observation) + '\n', 'utf8');
        console.log(`[DREAM] Session captured → ${path.basename(outPath)} (${observation.human_messages.length} msgs, ${observation.agents_run.length} agents)`);

        // Auto-trigger dream-worker (same 4h cooldown enforced inside dream-worker.js)
        try {
          const dreamWorker = path.join(__dirname, 'dream-worker.js');
          if (fs.existsSync(dreamWorker)) {
            const { spawn: _spawn } = require('child_process');
            _spawn('node', [dreamWorker], { detached: true, stdio: 'ignore' }).unref();
          }
        } catch (_) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }

    if (session && session.end) {
      session.end();
    } else {
      console.log('[OK] Session ended');
    }
  },

  'pre-task': () => {
    if (session && session.metric) {
      try { session.metric('tasks'); } catch (e) { /* no active session */ }
    }
    // Intelligence context BEFORE spawning task
    if (intelligence && intelligence.getContext && prompt) {
      try {
        const ctx = intelligence.getContext(prompt);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }
    // Route the task if router is available
    if (router && router.routeTask && prompt) {
      const result = router.routeTask(prompt);
      console.log(`[INFO] Task routed to: ${result.agent} (confidence: ${result.confidence})`);
    } else {
      console.log('[OK] Task started');
    }
  },

  'post-task': () => {
    // Implicit success feedback for intelligence
    if (intelligence && intelligence.feedback) {
      try {
        intelligence.feedback(true);
      } catch (e) { /* non-fatal */ }
    }
    // Mark router history as success
    if (router && router.markLastRoutingOutcome) {
      try { router.markLastRoutingOutcome(true); } catch (e) { /* non-fatal */ }
    }
    // Remove agent from active-agents.json
    try {
      const activeFile = path.join(process.env.HOME || '', '.claude', 'active-agents.json');
      const agentId = hookInput.agent_id || hookInput.tool_use_id;
      if (agentId) {
        let agents = {};
        try { agents = JSON.parse(fs.readFileSync(activeFile, 'utf8')); } catch (_) {}
        delete agents[agentId];
        // Also purge entries older than 30min (stale cleanup)
        const cutoff = Date.now() - 30 * 60 * 1000;
        Object.keys(agents).forEach(k => { if (agents[k].startedAt < cutoff) delete agents[k]; });
        fs.writeFileSync(activeFile, JSON.stringify(agents));
      }
    } catch (_) { /* non-fatal */ }
  },

  'status': () => {
    // SubagentStart — intelligence context for the spawning agent
    const desc = hookInput.description || prompt || '';
    if (intelligence && intelligence.getContext && desc) {
      try {
        const ctx = intelligence.getContext(desc);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }

    // Mnemosyne: load learned rules and inject into agent context
    try {
      const learningDir = path.join(process.env.HOME || '', '.claude', 'learning');
      // Article uses event.agent_type with plugin: prefix stripped
      const rawType = hookInput.agent_type || hookInput.tool_input?.subagent_type || 'general';
      const agentType = rawType.replace(/^[^:]+:/, '').trim().toLowerCase() || 'general';

      // Build injection context from hookInput
      const mnemoCtx = {
        agent_type: agentType,
        task: (hookInput.tool_input?.description || hookInput.tool_input?.prompt || '').slice(0, 500),
        tool: hookInput.tool_name || '',
        tags: [],
      };

      // Load rules (rules.json primary, .md fallback)
      function loadRulesJson(dir) {
        try {
          const raw = fs.readFileSync(path.join(dir, 'rules.json'), 'utf8');
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : (parsed.rules ?? []);
        } catch (_) { return null; }
      }

      function evalPred(pred, ctx) {
        try {
          const { field, op, value } = pred;
          const haystack = Array.isArray(ctx[field])
            ? ctx[field].join(' ')
            : String(ctx[field] ?? '');
          switch (op) {
            case 'contains': return haystack.toLowerCase().includes(String(value).toLowerCase());
            case 'regex':    try { return new RegExp(value, 'i').test(haystack); } catch (_) { return false; }
            case 'eq':       return haystack === value;
            case 'in':       return Array.isArray(value) && value.some(v => haystack.includes(v));
            default:         return false;
          }
        } catch (_) { return false; }
      }

      function matchesTrigger(rule, ctx) {
        try {
          const { match } = rule.trigger || {};
          if (!match || match.length === 0) return true;
          return match.every(orGroup =>
            orGroup.some(pred => evalPred(pred, ctx))
          );
        } catch (_) { return false; }
      }

      const jsonRules = loadRulesJson(learningDir);

      let rulesBlock = '';

      if (jsonRules !== null) {
        // rules.json path
        let active = jsonRules.filter(r =>
          !r.disabled && (r.confidence ?? 7) >= 6 && matchesTrigger(r, mnemoCtx)
        );
        if (active.length > 15) {
          active = active.sort((a, b) => (b.confidence ?? 7) - (a.confidence ?? 7)).slice(0, 15);
        }
        if (active.length > 0) {
          rulesBlock = active.map(r => `- ${r.rule}`).join('\n');
        }
      } else {
        // Fallback: legacy .md files
        const globalMd = path.join(learningDir, 'global.md');
        const agentMd  = path.join(learningDir, 'agents', `${agentType}.md`);
        let mdContent = '';
        if (fs.existsSync(globalMd)) {
          const content = fs.readFileSync(globalMd, 'utf8').trim();
          if (content) mdContent += content + '\n';
        }
        if (fs.existsSync(agentMd)) {
          const content = fs.readFileSync(agentMd, 'utf8').trim();
          if (content) mdContent += '\n' + content + '\n';
        }
        rulesBlock = mdContent.trim();
      }

      if (rulesBlock) {
        console.log(`<mnemosyne>\n${rulesBlock}\n</mnemosyne>`);
      }
    } catch (e) { /* non-fatal — never block agent spawn */ }

    // Track active agent in ~/.claude/active-agents.json
    try {
      const activeFile = path.join(process.env.HOME || '', '.claude', 'active-agents.json');
      const agentId = hookInput.agent_id || hookInput.tool_use_id || `agent-${Date.now()}`;
      const rawType2 = hookInput.agent_type || hookInput.tool_input?.subagent_type || 'unknown';
      const agentType2 = rawType2.replace(/^[^:]+:/, '').trim() || 'unknown';
      let agents = {};
      try { agents = JSON.parse(fs.readFileSync(activeFile, 'utf8')); } catch (_) {}
      agents[agentId] = { type: agentType2, startedAt: Date.now() };
      fs.writeFileSync(activeFile, JSON.stringify(agents));
    } catch (_) { /* non-fatal */ }
  },

  'stats': () => {
    if (intelligence && intelligence.stats) {
      intelligence.stats(args.includes('--json'));
    } else {
      console.log('[WARN] Intelligence module not available. Run session-restore first.');
    }
  },
};

  // Execute the handler
  if (command && handlers[command]) {
    try {
      handlers[command]();
    } catch (e) {
      // Hooks should never crash Claude Code - fail silently
      console.log(`[WARN] Hook ${command} encountered an error: ${e.message}`);
    }
  } else if (command) {
    // Unknown command - pass through without error
    console.log(`[OK] Hook: ${command}`);
  } else {
    console.log('Usage: hook-handler.cjs <route|pre-bash|post-edit|session-restore|session-end|pre-task|post-task|stats>');
  }
}

// Hooks must ALWAYS exit 0 — Claude Code treats non-zero as "hook error"
// and skips all subsequent hooks for the event.
process.exitCode = 0;
main().catch((e) => {
  try { console.log(`[WARN] Hook handler error: ${e.message}`); } catch (_) {}
}).finally(() => {
  process.exit(0);
});
