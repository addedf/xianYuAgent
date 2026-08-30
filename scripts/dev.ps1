$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $projectRoot "apps\web"
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue

if ($pnpmCommand) {
    & $pnpmCommand.Source --dir $webRoot dev
    exit $LASTEXITCODE
}

$localPnpm = Join-Path $env:LOCALAPPDATA "deepseek-harness\bin\pnpm.ps1"
if (Test-Path -LiteralPath $localPnpm) {
    & $localPnpm --dir $webRoot dev
    exit $LASTEXITCODE
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nextCli = Join-Path $webRoot "node_modules\next\dist\bin\next"
if ($nodeCommand -and (Test-Path -LiteralPath $nextCli)) {
    & $nodeCommand.Source $nextCli dev --hostname 127.0.0.1
    exit $LASTEXITCODE
}

throw "Unable to start the web app. Install Node.js 20.9+ and pnpm, then run pnpm install."
