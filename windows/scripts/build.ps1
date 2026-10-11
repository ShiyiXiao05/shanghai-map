param([string]$Dotnet='dotnet',[string]$OutputDirectory='')
$ErrorActionPreference='Stop'
$windowsRoot=Split-Path $PSScriptRoot -Parent
if(!$OutputDirectory){$OutputDirectory=Join-Path $windowsRoot 'artifacts/release'}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$temporary=Join-Path $windowsRoot 'artifacts/publish'
& $Dotnet publish (Join-Path $windowsRoot 'Modu.Desktop/Modu.Desktop.csproj') -c Release -r win-x64 --self-contained true -o $temporary --nologo
if($LASTEXITCODE -ne 0){throw 'Windows publication failed'}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$executable=Join-Path $OutputDirectory 'ModuExplore.exe'
Copy-Item -LiteralPath (Join-Path $temporary 'ModuExplore.exe') -Destination $executable -Force
Copy-Item -LiteralPath (Join-Path $windowsRoot 'README.md') -Destination (Join-Path $OutputDirectory 'README.md') -Force
Copy-Item -LiteralPath (Join-Path $windowsRoot 'THIRD_PARTY.md') -Destination (Join-Path $OutputDirectory 'THIRD_PARTY.md') -Force
$hash=(Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
$release=@{releases=@(@{versionCode=1;versionName='0.1.0-preview';channel='preview';publishedAt='2026-10-12';exeUrl='https://shanghai-wish-map.onrender.com/windows/ModuExplore-0.1.0-preview.exe';sha256=$hash;notes="Windows 原生客户端首次推出。`n全新桌面界面、地点管理、照片留言、行程、回忆、海报和回收站。`n支持本地缓存、键盘操作、主题设置和体验版更新渠道。"})}
$release | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'releases.json')
"$hash  ModuExplore.exe" | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'SHA256SUMS.txt')
Write-Output "Standalone executable: $executable"
