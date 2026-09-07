[CmdletBinding()]
param(
    [string]$DataDir = $env:MYOPC_DATA_DIR,
    [ValidateRange(1, 65535)]
    [int]$Port = 3000,
    [switch]$Production,
    [switch]$Check
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "未找到 Node.js。请先安装 Node.js 24 或更高版本。"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "未找到 npm。请确认 Node.js 安装完整。"
}

$myopcNodeVersion = (node --version).TrimStart("v")
$myopcNodeMajor = [int]($myopcNodeVersion.Split(".")[0])
if ($myopcNodeMajor -lt 24) {
    throw "当前 Node.js 为 v$myopcNodeVersion，MYOPC 需要 Node.js 24 或更高版本。"
}

if ([string]::IsNullOrWhiteSpace($DataDir)) {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw "无法确定私有数据目录，请使用 -DataDir 显式指定。"
    }
    $DataDir = Join-Path $env:LOCALAPPDATA "MYOPC\data"
}

$myopcDataDirectory = [System.IO.Path]::GetFullPath($DataDir)
New-Item -ItemType Directory -Path $myopcDataDirectory -Force | Out-Null
$env:MYOPC_DATA_DIR = $myopcDataDirectory

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules"))) {
    Write-Host "首次运行，正在安装锁定依赖..." -ForegroundColor Cyan
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "依赖安装失败。" }
}

Write-Host "MYOPC 启动检查通过" -ForegroundColor Green
Write-Host "数据目录：$myopcDataDirectory"
Write-Host "访问地址：http://127.0.0.1:$Port"

if ($Check) {
    Write-Host "仅检查模式，不启动服务。"
    exit 0
}

if ($Production) {
    Write-Host "正在构建生产版本..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "生产构建失败。" }
    npm run start -- --hostname 127.0.0.1 --port $Port
} else {
    npm run dev -- --hostname 127.0.0.1 --port $Port
}

if ($LASTEXITCODE -ne 0) { throw "MYOPC 服务异常退出，代码：$LASTEXITCODE" }

