# 安装 OPC Bridge：复制 CLI 到 %LOCALAPPDATA%\OPC\bin，写入 opc.cmd，并把该目录加入用户 PATH。
# 只安装一次，不在任何项目仓库里产生文件。
param(
  [string]$OpcHome = (Join-Path $env:LOCALAPPDATA 'OPC'),
  [string]$ServerUrl = '',
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

$bin = Join-Path $OpcHome 'bin'
New-Item -ItemType Directory -Force -Path $bin, (Join-Path $OpcHome 'logs'), (Join-Path $OpcHome 'cache') | Out-Null

Copy-Item -Path (Join-Path $PSScriptRoot 'opc.mjs') -Destination (Join-Path $bin 'opc.mjs') -Force
$shim = "@echo off`r`nnode `"%~dp0opc.mjs`" %*`r`n"
Set-Content -Path (Join-Path $bin 'opc.cmd') -Value $shim -Encoding ascii -NoNewline
Write-Host "CLI: $(Join-Path $bin 'opc.cmd')"

$configPath = Join-Path $OpcHome 'config.json'
if (-not (Test-Path $configPath) -or $Force) {
  $target = if ($ServerUrl) { $ServerUrl } else { 'http://127.0.0.1:3000' }
  $config = [ordered]@{
    serverUrl = $target
    auth      = [ordered]@{ username = ''; password = '' }
    timeoutMs = 60000
    cacheMinutes = 10
    enabled   = $true
  }
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "配置: $configPath（serverUrl=$target）"
} else {
  Write-Host "配置: $configPath（已存在，保持不变）"
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $bin) {
  [Environment]::SetEnvironmentVariable('Path', ((@($parts) + $bin) -join ';'), 'User')
  Write-Host "已把 $bin 加入用户 PATH（新开的终端生效）"
} else {
  Write-Host "$bin 已在用户 PATH 中"
}

& (Join-Path $bin 'opc.cmd') version
Write-Host '安装完成：opc context / opc result / opc doctor'
