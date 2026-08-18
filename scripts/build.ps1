# dsh-plugin-updater - Windows native build script (3.11)
# Auto-detect DSH runtime (DSH_CHECKOUT env, else %LOCALAPPDATA%\DeepSeek Harness\runtime),
# junction-link compile deps from runtime node_modules, then tsc (host) + tsdown (client).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build.ps1
$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo

# ---- 1. detect DSH runtime ----
$runtime = $env:DSH_CHECKOUT
if (-not $runtime -or -not (Test-Path (Join-Path $runtime 'node_modules'))) {
  $cand = Join-Path $env:LOCALAPPDATA 'DeepSeek Harness\runtime'
  if (Test-Path (Join-Path $cand 'node_modules')) { $runtime = $cand }
}
if (-not $runtime -or -not (Test-Path (Join-Path $runtime 'node_modules'))) {
  $cands = @($env:DSH_CHECKOUT, (Join-Path $env:LOCALAPPDATA 'DeepSeek Harness\runtime'), (Join-Path $env:USERPROFILE '.dsh\profiles\web'))
  foreach ($c in $cands) {
    if ($c -and (Test-Path (Join-Path $c 'node_modules'))) { $runtime = $c; break }
  }
}
if (-not $runtime) { throw 'Cannot locate DSH runtime (node_modules). Set DSH_CHECKOUT or check %LOCALAPPDATA%\DeepSeek Harness\runtime.' }
Write-Host "DSH runtime: $runtime" -ForegroundColor Cyan

$rtNm = Join-Path $runtime 'node_modules'
$scope = Join-Path $rtNm '@deepseek-ai'

# ---- 2. junction-link compile deps from runtime ----
$links = @(
  @{ Rel = 'cordis';                    Target = Join-Path $scope 'cordis' },
  @{ Rel = 'cosmokit';                  Target = Join-Path $scope 'cosmokit' },
  @{ Rel = 'schemastery';               Target = Join-Path $scope 'schemastery' },
  @{ Rel = '@deepseek-ai\dsh-tools';    Target = Join-Path $scope 'dsh-tools' },
  @{ Rel = '@deepseek-ai\dsh-client-ui-slots'; Target = Join-Path $scope 'dsh-client-ui-slots' },
  @{ Rel = '@deepseek-ai\dsh-llm';      Target = Join-Path $scope 'dsh-llm' },
  @{ Rel = '@deepseek-ai\dsh-system-prompt'; Target = Join-Path $scope 'dsh-system-prompt' },
  @{ Rel = '@types\node';               Target = Join-Path $rtNm '@types\node' }
)

foreach ($l in $links) {
  $link = Join-Path (Join-Path $Repo 'node_modules') $l.Rel
  if (-not (Test-Path $l.Target)) { Write-Warning "skip (missing target): $($l.Rel) -> $($l.Target)"; continue }
  if (Test-Path $link) { Remove-Item -LiteralPath $link -Recurse -Force }
  $parent = Split-Path $link -Parent
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  New-Item -ItemType Junction -Path $link -Target $l.Target | Out-Null
  Write-Host "  linked $($l.Rel)" -ForegroundColor DarkGray
}

# ---- 3. compile host (tsc) ----
Write-Host "`n=== tsc (host) ===" -ForegroundColor Cyan
& tsc -p tsconfig.json
if ($LASTEXITCODE -ne 0) { throw "tsc failed: $LASTEXITCODE" }
Write-Host "tsc OK" -ForegroundColor Green

# ---- 4. build client (tsdown) ----
Write-Host "`n=== tsdown (client) ===" -ForegroundColor Cyan
& tsdown
if ($LASTEXITCODE -ne 0) { throw "tsdown failed: $LASTEXITCODE" }
Write-Host "tsdown OK" -ForegroundColor Green

Write-Host ""
Write-Host "build done." -ForegroundColor Green
Write-Host "host  : lib\index.js + lib\*.js"
Write-Host "client: lib\client.js"
