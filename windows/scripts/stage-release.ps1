param([string]$Dotnet='dotnet')
$ErrorActionPreference='Stop'
$repositoryRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $repositoryRoot
try {
    & "$PSScriptRoot/build.ps1" -Dotnet $Dotnet -OutputDirectory (Join-Path $repositoryRoot 'windows/artifacts/ci-release')
    $destination=Join-Path $repositoryRoot 'windows/artifacts/release-assets'
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $android=(Get-Content public/android/releases.json -Raw | ConvertFrom-Json).releases | Where-Object channel -eq 'preview' | Sort-Object versionCode -Descending | Select-Object -First 1
    $apkName=[IO.Path]::GetFileName(([uri]$android.apkUrl).AbsolutePath)
    if($apkName -notmatch '^modu-explore-[0-9.]+-preview\.apk$'){throw 'Invalid Android package filename'}
    $apk=Join-Path $repositoryRoot "public/android/$apkName"
    if((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -ine $android.sha256){throw 'Archived Android APK does not match the release catalog'}
    $desktop=(Get-Content windows/artifacts/ci-release/releases.json -Raw | ConvertFrom-Json).releases[0]
    $exeName="ModuExplore-$($desktop.versionName)-win-x64.exe"
    Copy-Item -LiteralPath $apk -Destination (Join-Path $destination $apkName) -Force
    Copy-Item -LiteralPath windows/artifacts/ci-release/ModuExplore.exe -Destination (Join-Path $destination $exeName) -Force
    Copy-Item -LiteralPath docs/releases/INSTALL.md -Destination (Join-Path $destination 'INSTALL.md') -Force
    Copy-Item -LiteralPath windows/THIRD_PARTY.md -Destination (Join-Path $destination 'Windows-THIRD-PARTY.md') -Force
    $files=@($apkName,$exeName,'INSTALL.md','Windows-THIRD-PARTY.md')
    $hashes=$files | Sort-Object | ForEach-Object { $path=Join-Path $destination $_; "$((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant())  $_" }
    $hashes | Set-Content -Encoding utf8 (Join-Path $destination 'SHA256SUMS.txt')
    Write-Output "Staged Android $($android.versionName) and Windows $($desktop.versionName)"
} finally { Pop-Location }
