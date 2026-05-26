#Requires -Version 5.1
<#
.SYNOPSIS
    Claudly — Claude Code Intelligence Stack Installer (Windows)
.DESCRIPTION
    Installs Claude Code + RTK + lean-ctx + claude-flow + ruflo + MCPs
    + Obsidian vault + hooks/agents/skills on Windows.
.NOTES
    Run: powershell -ExecutionPolicy Bypass -File install.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$REPO_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$USERNAME = $env:USERNAME
$HOME_DIR = $env:USERPROFILE

function Info($msg) { Write-Host "  → $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }
function Has($cmd)  { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "================================================" -ForegroundColor Blue
Write-Host " Claudly — Claude Code Setup Installer (Windows)"
Write-Host " User: $USERNAME | Home: $HOME_DIR"
Write-Host "================================================"
Write-Host ""

# ── API Key ──────────────────────────────────────────────────
if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host "ANTHROPIC_API_KEY not set."
    Write-Host "Get yours at: https://console.anthropic.com/keys"
    $apiKey = Read-Host "  Paste API key (or Enter to skip)"
    if ($apiKey) {
        $env:ANTHROPIC_API_KEY = $apiKey
        $profilePath = $PROFILE
        if (-not (Test-Path $profilePath)) { New-Item -Path $profilePath -Force | Out-Null }
        $content = Get-Content $profilePath -Raw -ErrorAction SilentlyContinue
        if ($content -notmatch 'ANTHROPIC_API_KEY') {
            Add-Content -Path $profilePath -Value "`n`$env:ANTHROPIC_API_KEY = '$apiKey'"
        }
        [System.Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $apiKey, "User")
        Ok "API key saved to user environment + PowerShell profile"
    } else {
        Info "Skipped. Set ANTHROPIC_API_KEY in system environment before running claude."
    }
}
Write-Host ""

# ── Placeholder substitution ─────────────────────────────────
function Apply-Placeholders($dir) {
    $extensions = @("*.json","*.sh","*.cjs","*.js","*.mjs","*.ts","*.md","*.yaml","*.yml","*.ps1")
    foreach ($ext in $extensions) {
        Get-ChildItem -Path $dir -Filter $ext -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
            $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
            if ($content) {
                $updated = $content -replace '__HOME__', ($HOME_DIR -replace '\\', '/') `
                                    -replace '__USERNAME__', $USERNAME
                if ($updated -ne $content) {
                    Set-Content -Path $_.FullName -Value $updated -NoNewline
                }
            }
        }
    }
}

# ── 1. Prerequisites ─────────────────────────────────────────
Write-Host "[1/8] Checking prerequisites..."

if (-not (Has "node")) {
    if (Has "winget") {
        Info "Installing Node.js via winget..."
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>$null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } elseif (Has "choco") {
        Info "Installing Node.js via Chocolatey..."
        choco install nodejs-lts -y 2>$null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } else {
        Fail "Node.js not found. Install from https://nodejs.org or install winget/chocolatey first."
    }
}

if (-not (Has "git")) {
    Fail "Git not found. Install from https://git-scm.com/download/win"
}

Ok "Prerequisites ready (Node $(node --version), Git $(git --version | Select-String '\d+\.\d+' | ForEach-Object {$_.Matches.Value}))"

# ── 2. Claude Code ───────────────────────────────────────────
Write-Host "[2/8] Installing Claude Code..."
if (-not (Has "claude")) {
    npm install -g @anthropic-ai/claude-code 2>$null
    Ok "Claude Code installed"
} else {
    Ok "Claude Code already installed"
}

# ── 3. RTK ──────────────────────────────────────────────────
Write-Host "[3/8] Installing RTK (token optimizer)..."
if (-not (Has "rtk")) {
    if (Has "winget") {
        winget install rtk-ai.rtk --accept-source-agreements --accept-package-agreements 2>$null
    } elseif (Has "scoop") {
        scoop install rtk 2>$null
    } else {
        Info "RTK: install manually from https://github.com/rtk-ai/rtk/releases"
        Info "Download rtk.exe and add to PATH"
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    if (Has "rtk") { Ok "RTK installed" } else { Info "RTK: install manually after setup" }
} else {
    Ok "RTK already installed"
}

# ── 4. lean-ctx ─────────────────────────────────────────────
Write-Host "[4/8] Installing lean-ctx..."
if (-not (Has "lean-ctx")) {
    if (Has "winget") {
        winget install yvgude.lean-ctx --accept-source-agreements --accept-package-agreements 2>$null
    } elseif (Has "scoop") {
        scoop install lean-ctx 2>$null
    } else {
        Info "lean-ctx: install manually from https://leanctx.com"
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

if (Has "lean-ctx") {
    lean-ctx init --agent claude 2>$null
    Ok "lean-ctx MCP registered"
} else {
    Info "lean-ctx: run 'lean-ctx init --agent claude' after manual install"
}

# ── 5. claude-flow + ruflo + MCPs ────────────────────────────
Write-Host "[5/8] Installing claude-flow, ruflo, MCPs..."

npm install -g @claude-flow/cli 2>$null
if ($?) { Ok "claude-flow installed" } else { Info "claude-flow: run 'npm i -g @claude-flow/cli' manually" }

npm install -g ruflo 2>$null

try { claude mcp add claude-flow "npx -y @claude-flow/cli@latest mcp start" 2>$null; Ok "claude-flow MCP registered" } catch {}
try { claude mcp add ruflo "npx -y ruflo@latest mcp start" 2>$null; Ok "ruflo MCP registered" } catch {}

# screen-vision MCP
$screenVisionDir = Join-Path $HOME_DIR ".claude\mcp-servers\screen-vision-mcp"
if (-not (Test-Path $screenVisionDir)) {
    Info "Installing screen-vision MCP..."
    New-Item -Path (Join-Path $HOME_DIR ".claude\mcp-servers") -ItemType Directory -Force | Out-Null
    git clone https://github.com/TIMBOTGPT/screen-vision-mcp.git $screenVisionDir 2>$null
    if (Test-Path $screenVisionDir) {
        Push-Location $screenVisionDir
        npm install --silent 2>$null
        Pop-Location
        try { claude mcp add screen-vision "node $($screenVisionDir -replace '\\','/')/index.js" 2>$null; Ok "screen-vision MCP installed" } catch {}
    }
} else {
    Ok "screen-vision already installed"
}

# symdex MCP
if (Has "uvx") {
    try { claude mcp add symdex "uvx symdex serve" 2>$null; Ok "symdex MCP registered" } catch {}
} elseif (Has "pip") {
    Info "Installing uv for symdex..."
    pip install uv 2>$null
    if (Has "uvx") { try { claude mcp add symdex "uvx symdex serve" 2>$null; Ok "symdex MCP registered" } catch {} }
}

# ── 6. ~/.claude config ──────────────────────────────────────
Write-Host "[6/8] Setting up Claude Code config..."

$claudeDir = Join-Path $HOME_DIR ".claude"

if (Test-Path $claudeDir) {
    $backupName = ".claude.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    $backupPath = Join-Path $HOME_DIR $backupName
    Info "Backing up existing .claude → $backupName"
    Copy-Item -Path $claudeDir -Destination $backupPath -Recurse -Force
}

# Copy config files (exclude runtime state)
$excludeDirs = @("projects","logs","telemetry","paste-cache","file-history",
                  "mcp-servers","plugins","sessions","cache","shell-snapshots",
                  "backups","learning","patches")

$sourceDir = Join-Path $REPO_DIR "claude"
if (-not (Test-Path $claudeDir)) { New-Item -Path $claudeDir -ItemType Directory -Force | Out-Null }

Get-ChildItem -Path $sourceDir -Recurse -Force | ForEach-Object {
    $relativePath = $_.FullName.Substring($sourceDir.Length + 1)
    $skip = $false
    foreach ($exc in $excludeDirs) {
        if ($relativePath -like "$exc\*" -or $relativePath -eq $exc) { $skip = $true; break }
    }
    if ($relativePath -eq "settings.local.json" -or $relativePath -eq "history.jsonl") { $skip = $true }

    if (-not $skip) {
        $destPath = Join-Path $claudeDir $relativePath
        if ($_.PSIsContainer) {
            if (-not (Test-Path $destPath)) { New-Item -Path $destPath -ItemType Directory -Force | Out-Null }
        } else {
            $destDir = Split-Path $destPath -Parent
            if (-not (Test-Path $destDir)) { New-Item -Path $destDir -ItemType Directory -Force | Out-Null }
            Copy-Item -Path $_.FullName -Destination $destPath -Force
        }
    }
}

Apply-Placeholders $claudeDir

# Create runtime directories
New-Item -Path (Join-Path $claudeDir "logs") -ItemType Directory -Force | Out-Null
New-Item -Path (Join-Path $claudeDir "helpers\janitor\logs") -ItemType Directory -Force | Out-Null

Ok "Claude Code config installed"

# ── 7. Plugins ──────────────────────────────────────────────
Write-Host "[7/8] Installing Claude Code plugins..."
Info "Plugins auto-install on first 'claude' run (caveman, codex, impeccable, karpathy-skills, stripe, vercel)"
Ok "Plugin config ready"

# ── 8. Obsidian ──────────────────────────────────────────────
Write-Host "[8/8] Setting up Obsidian..."
$vaultDir = Join-Path $HOME_DIR "Desktop\Labirynt"

if (Test-Path $vaultDir) {
    Info "Vault already exists at $vaultDir — updating CLAUDE.md only"
    Copy-Item -Path (Join-Path $REPO_DIR "obsidian\CLAUDE.md") -Destination (Join-Path $vaultDir "CLAUDE.md") -Force -ErrorAction SilentlyContinue
} else {
    Copy-Item -Path (Join-Path $REPO_DIR "obsidian\vault") -Destination $vaultDir -Recurse -Force
    Copy-Item -Path (Join-Path $REPO_DIR "obsidian\CLAUDE.md") -Destination (Join-Path $vaultDir "CLAUDE.md") -Force -ErrorAction SilentlyContinue

    # Create Domain Knowledge structure
    $domainsDir = Join-Path $vaultDir "3 Atlas\Domains"
    New-Item -Path $domainsDir -ItemType Directory -Force | Out-Null
    if (-not (Test-Path (Join-Path $domainsDir "INDEX.md"))) {
        Set-Content -Path (Join-Path $domainsDir "INDEX.md") -Value "# Domain Index"
    }

    # vault-log.md
    if (-not (Test-Path (Join-Path $vaultDir "vault-log.md"))) {
        Set-Content -Path (Join-Path $vaultDir "vault-log.md") -Value "# Vault Operations Log"
    }

    # Download Excalidraw plugin
    $excalidrawDir = Join-Path $vaultDir ".obsidian\plugins\obsidian-excalidraw-plugin"
    $excalidrawVer = "2.22.0"
    if ((Test-Path $excalidrawDir) -and -not (Test-Path (Join-Path $excalidrawDir "main.js"))) {
        Info "Downloading Excalidraw plugin ($excalidrawVer)..."
        try {
            Invoke-WebRequest -Uri "https://github.com/zsviczian/obsidian-excalidraw-plugin/releases/download/$excalidrawVer/main.js" `
                -OutFile (Join-Path $excalidrawDir "main.js") -UseBasicParsing
            Ok "Excalidraw downloaded"
        } catch {
            Info "Excalidraw download failed — enable manually in Obsidian"
        }
    }

    Ok "Obsidian vault + plugins created at $vaultDir"
}

# Install Obsidian if not present
if (-not (Test-Path "$env:LOCALAPPDATA\Obsidian\Obsidian.exe") -and -not (Test-Path "$env:ProgramFiles\Obsidian\Obsidian.exe")) {
    if (Has "winget") {
        Info "Installing Obsidian..."
        winget install Obsidian.Obsidian --accept-source-agreements --accept-package-agreements 2>$null
        Ok "Obsidian installed"
    } else {
        Info "Install Obsidian from https://obsidian.md/download"
    }
} else {
    Ok "Obsidian already installed"
}

# ── lean-ctx shell hook ──────────────────────────────────────
if (Has "lean-ctx") {
    lean-ctx init 2>$null
    Ok "lean-ctx shell aliases installed"
}

# ── Scheduled tasks (Windows equivalent of cron) ─────────────
Write-Host ""
Write-Host "[post-install] Setting up scheduled tasks..."

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { $nodePath = "node" }
$claudePath = "$HOME_DIR\.claude"

$tasks = @(
    @{ Name="Claudly-WeeklyReview";   Schedule="WEEKLY"; Day="SUN"; Time="20:00";
       Command="bash `"$claudePath/scripts/ruflo-weekly-review.sh`"" },
    @{ Name="Claudly-BiweeklyHygiene"; Schedule="WEEKLY"; Day="SUN"; Time="20:30";
       Command="bash `"$claudePath/scripts/ruflo-hygiene.sh`"" },
    @{ Name="Claudly-MonthlyConsolidate"; Schedule="MONTHLY"; Day="1"; Time="20:00";
       Command="bash `"$claudePath/scripts/ruflo-monthly-consolidate.sh`"" },
    @{ Name="Claudly-SkillMapUpdate"; Schedule="WEEKLY"; Day="SUN"; Time="21:00";
       Command="bash `"$claudePath/scripts/skill-map-update.sh`"" },
    @{ Name="Claudly-Janitor"; Schedule="DAILY"; Time="02:00";
       Command="$nodePath `"$claudePath/helpers/janitor/orchestrator.mjs`"" }
)

$gitBash = ""
if (Test-Path "C:\Program Files\Git\bin\bash.exe") { $gitBash = "C:\Program Files\Git\bin\bash.exe" }
elseif (Test-Path "C:\Program Files (x86)\Git\bin\bash.exe") { $gitBash = "C:\Program Files (x86)\Git\bin\bash.exe" }

$tasksCreated = 0
foreach ($task in $tasks) {
    try {
        # Remove existing task if present
        schtasks /Delete /TN $task.Name /F 2>$null | Out-Null

        if ($task.Command -match "^bash ") {
            if ($gitBash) {
                $script = ($task.Command -replace '^bash ', '') -replace '"', ''
                $schedArgs = "/Create /SC $($task.Schedule) /TN `"$($task.Name)`" /TR `"'$gitBash' '$script'`" /ST $($task.Time) /F"
            } else {
                continue
            }
        } else {
            $schedArgs = "/Create /SC $($task.Schedule) /TN `"$($task.Name)`" /TR `"$($task.Command)`" /ST $($task.Time) /F"
        }

        if ($task.Day -and $task.Schedule -eq "WEEKLY") {
            $schedArgs += " /D $($task.Day)"
        } elseif ($task.Day -and $task.Schedule -eq "MONTHLY") {
            $schedArgs += " /D $($task.Day)"
        }

        $proc = Start-Process schtasks -ArgumentList $schedArgs -NoNewWindow -PassThru -Wait 2>$null
        if ($proc.ExitCode -eq 0) { $tasksCreated++ }
    } catch {
        # Non-admin — tasks require elevation
    }
}

if ($tasksCreated -gt 0) {
    Ok "$tasksCreated scheduled tasks created"
} else {
    Info "Scheduled tasks require admin privileges. Run as Administrator to install, or create manually."
    Info "Tasks: WeeklyReview (Sun 20:00), Hygiene (Sun 20:30), MonthlyConsolidate (1st 20:00), SkillMap (Sun 21:00), Janitor (daily 02:00)"
}

# ── Done ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " Setup complete!"
Write-Host ""
Write-Host " Verify installation:"
Write-Host "   claude --version"
Write-Host "   rtk --version"
Write-Host "   lean-ctx --version"
Write-Host "   claude mcp list"
Write-Host ""
Write-Host " First steps:"
Write-Host "   1. Restart terminal (shell hooks activate on new session)"
Write-Host "   2. Open Obsidian → Open folder as vault → $vaultDir"
Write-Host "      Enable community plugins when prompted"
Write-Host "   3. Run: claude"
Write-Host "   4. Type /graphify to build initial knowledge graph"
Write-Host "   5. Read: GETTING_STARTED.md in this repo"
Write-Host ""
Write-Host " What's installed:"
Write-Host "   - Claude Code CLI + skills + agents"
Write-Host "   - RTK token optimizer (60-90% savings)"
Write-Host "   - lean-ctx context engineering layer"
Write-Host "   - claude-flow + ruflo + MCP servers"
Write-Host "   - Obsidian vault with 8 plugins + templates"
Write-Host "   - Scheduled tasks (Windows Task Scheduler)"
Write-Host "   - Hooks (pre/post tool, session, routing)"
Write-Host "   - GSD (Get Shit Done) framework"
Write-Host "================================================"
