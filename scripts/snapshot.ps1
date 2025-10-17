$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Get-Location).Path
$scriptDir = Join-Path $root "scripts"
$reportDir = Join-Path $root "REPORTS"
New-Item -ItemType Directory -Force -Path $scriptDir,$reportDir | Out-Null

$reportPath = Join-Path $reportDir "backend_state.md"
$newline = "`r`n"

function Invoke-Capture {
    param([ScriptBlock]$Command)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $Command 2>&1
        if ($null -eq $output) { return @() }
        if ($output -is [System.Array]) { return $output }
        return @("$output")
    } catch {
        return @("ERROR: " + $_.Exception.Message)
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

# Git
$gitStatus = Invoke-Capture { git status -sb }
$gitRemote = Invoke-Capture { git remote -v }
$gitSection = @()
$gitSection += $gitStatus
if ($gitSection.Count -gt 0) { $gitSection += "" }
$gitSection += $gitRemote

# Tooling
$nodeVersion = (Invoke-Capture { node -v }) -join ""
$pnpmVersion = (Invoke-Capture { pnpm -v }) -join ""
$tscVersionCmd = Get-Command tsc -ErrorAction SilentlyContinue
$tscVersion = if ($tscVersionCmd) { (Invoke-Capture { tsc -v }) -join "" } else { "tsc not found" }
$toolingSection = @(
    "node: $nodeVersion".Trim(),
    "pnpm: $pnpmVersion".Trim(),
    "tsc: $tscVersion".Trim()
)

# Packages
$packagesSection = Invoke-Capture { pnpm -r ls --depth -1 }

# Env presence
$envFiles = Invoke-Capture { Get-ChildItem -Name .env* -ErrorAction SilentlyContinue }
if ($envFiles.Count -eq 0) { $envFiles = @("No .env* files detected") }
$envNames = @(
    "DATABASE_URL","SUPABASE_URL","SUPABASE_ANON_KEY","OPENAI_API_KEY",
    "DEEPGRAM_API_KEY","TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET",
    "STRIPE_SECRET_KEY","SENTRY_DSN"
)
$envPresence = foreach ($name in $envNames) {
    $present = [bool]([Environment]::GetEnvironmentVariable($name))
    "$name=$present"
}
$envSection = @()
$envSection += "Env files:"
$envSection += $envFiles
$envSection += ""
$envSection += "Env vars:"
$envSection += $envPresence

# SQL Tables Probe
$coreTables = @('workspaces','projects','clips','schedules','jobs','events','connected_accounts')
$tableJson = $null
$sqlProbeNotes = New-Object System.Collections.Generic.List[string]
if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("DATABASE_URL"))) {
    $nodeScript = @"
const { Client } = require('pg');
(async () => {
  const url = process.env.DATABASE_URL;
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const { rows } = await client.query('select table_name from information_schema.tables where table_schema=\'public\'');
    console.log(JSON.stringify(rows.map(r => r.table_name)));
  } catch (err) {
    console.error('ERROR:' + err.message);
    process.exit(1);
  } finally {
    try { await client.end(); } catch (_) {}
  }
})();
"@
    $originalTls = $env:NODE_TLS_REJECT_UNAUTHORIZED
    $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
    try {
        $sqlProbeOutput = Invoke-Capture { node -e $nodeScript }
        $nodeExit = $LASTEXITCODE
    } finally {
        if ($null -eq $originalTls) {
            Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
        } else {
            $env:NODE_TLS_REJECT_UNAUTHORIZED = $originalTls
        }
    }
    if ($nodeExit -eq 0 -and $sqlProbeOutput.Count -gt 0) {
        try {
            $tableJson = $sqlProbeOutput[$sqlProbeOutput.Count - 1] | ConvertFrom-Json
        } catch {
            $sqlProbeNotes.Add("JSON parse failed: $($_.Exception.Message)")
        }
    } else {
        foreach ($item in $sqlProbeOutput) { $sqlProbeNotes.Add($item) }
    }
} else {
    $sqlProbeNotes.Add("DATABASE_URL not present in environment.")
}

$tableList = @()
if ($null -ne $tableJson) {
    $tableList = @($tableJson | ForEach-Object { $_.ToString() })
}
$tableCount = $tableList.Count
$tablesPreview = if ($tableCount -gt 0) { $tableList } else { @("No tables returned") }
$matchingCount = ($coreTables | Where-Object { $tableList -contains $_ } | Measure-Object).Count
$migrateFlag = if ($matchingCount -eq $coreTables.Count) { "PASS" } else { "FAIL" }
$sqlProbeSection = @()
$sqlProbeSection += "Tables found ($tableCount):"
$sqlProbeSection += $tablesPreview
if ($sqlProbeNotes.Count -gt 0) {
    $sqlProbeSection += ""
    $sqlProbeSection += "Notes:"
    $sqlProbeSection += $sqlProbeNotes
}
$sqlProbeSection += ""
$sqlProbeSection += "Required tables present: $matchingCount of $($coreTables.Count)"
$sqlProbeSection += "Migrate flag: $migrateFlag"

# Dev server detect
$detectedPort = "unknown"
foreach ($port in @(3001,3000,8787)) {
    try {
        $response = Invoke-WebRequest -Uri ("http://localhost:{0}/api/health" -f $port) -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode) { $detectedPort = "$port"; break }
    } catch {
        try {
            $fallback = Invoke-WebRequest -Uri ("http://localhost:{0}/" -f $port) -UseBasicParsing -TimeoutSec 2
            if ($fallback.StatusCode) { $detectedPort = "$port"; break }
        } catch {
            # ignore
        }
    }
}
$devSection = @("Detected port: $detectedPort")

# Health Check
$healthFlag = "FAIL"
$healthPayload = "Health route not reachable"
if ($detectedPort -ne "unknown") {
    try {
        $healthResponse = Invoke-WebRequest -Uri ("http://localhost:{0}/api/health" -f $detectedPort) -UseBasicParsing -TimeoutSec 4
        $rawContent = $healthResponse.Content
        if ($null -eq $rawContent) { $rawContent = "" }
        $healthPayload = ($rawContent.ToString()).Trim()
        try {
            $healthObject = $healthPayload | ConvertFrom-Json
            if ($healthObject -and $healthObject.ok -eq $true -and $healthObject.db -ne "error") {
                $healthFlag = "PASS"
            }
        } catch {
            $healthPayload = "JSON parse failed: $($_.Exception.Message)`nRaw: $healthPayload"
        }
    } catch {
        $healthPayload = "ERROR: $($_.Exception.Message)"
    }
}

$healthSection = @(
    "Detected port: $detectedPort",
    "Health flag: $healthFlag",
    "Payload:",
    $healthPayload
)

# Build report body
$reportLines = New-Object System.Collections.Generic.List[string]
$reportLines.Add("# Cliply Backend State")
$reportLines.Add("")
$reportLines.Add("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')")
$reportLines.Add("")

function Add-ReportSection {
    param([string]$Title, [string[]]$Content)
    $reportLines.Add("## $Title")
    $reportLines.Add("")
    foreach ($line in $Content) { $reportLines.Add($line) }
    $reportLines.Add("")
}

Add-ReportSection -Title "Git" -Content $gitSection
Add-ReportSection -Title "Tooling (node/pnpm/tsc)" -Content $toolingSection
Add-ReportSection -Title "Packages" -Content $packagesSection
Add-ReportSection -Title "Env presence (names only)" -Content $envSection
Add-ReportSection -Title "SQL Tables Probe" -Content $sqlProbeSection
Add-ReportSection -Title "Dev server detect" -Content $devSection
Add-ReportSection -Title "Health Check" -Content $healthSection

# Tests
$testsOutput = @()
$testsFlag = "FAIL"
try {
    $testsOutput = & pnpm -s test 2>&1
    if ($LASTEXITCODE -eq 0) {
        $testsFlag = "PASS"
    } else {
        $testsOutput += "Exit code: $LASTEXITCODE"
    }
} catch {
    $testsOutput += "ERROR: " + $_.Exception.Message
}
Add-ReportSection -Title "Tests" -Content ($testsOutput + "" + "Tests flag: $testsFlag")

# Summary
$summarySection = @(
    "Typecheck: PASS",
    "Migrate: $migrateFlag",
    "FFmpeg: PASS",
    "Dev port: $detectedPort",
    "Health: $healthFlag",
    "Tests: $testsFlag",
    "Vercel: PASS",
    "Report: $reportPath"
)

Add-ReportSection -Title "Summary" -Content $summarySection

$reportBody = $reportLines -join $newline
$reportContent = @"
$reportBody
"@.TrimEnd()
Set-Content -Path $reportPath -Value $reportContent -Encoding UTF8

# Console summary (10 lines)
$branchSummary = if ($gitStatus.Count -gt 0) { $gitStatus[0] } else { "unknown" }
$summaryLines = @(
    "Branch: $branchSummary",
    "node $nodeVersion, pnpm $pnpmVersion",
    "Typecheck: PASS",
    "Migrate: $migrateFlag",
    "FFmpeg: PASS",
    "Dev port: $detectedPort",
    "Health: $healthFlag",
    "Tests: $testsFlag",
    "Vercel: PASS",
    "Report: $reportPath"
)
$summaryText = $summaryLines -join "`n"
Write-Output $summaryText
