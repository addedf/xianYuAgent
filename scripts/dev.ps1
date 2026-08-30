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

throw "未找到 pnpm。请安装 Node.js 20.9+ 与 pnpm，然后重新运行本脚本。"

