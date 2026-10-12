$ErrorActionPreference='Stop'
if(!$env:GH_TOKEN -or !$env:RELEASE_TAG -or !$env:GITHUB_REPOSITORY){throw 'Run this publisher through the GitHub release workflow'}
$repositoryRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $repositoryRoot
try {
    $destination=Join-Path $repositoryRoot 'windows/artifacts/release-assets'
    $files=@(Get-ChildItem $destination -File)
    if(@($files | Where-Object Extension -eq '.apk').Count -ne 1 -or @($files | Where-Object Extension -eq '.exe').Count -ne 1){throw 'Both installable packages are required'}
    $existing=gh release view $env:RELEASE_TAG --repo $env:GITHUB_REPOSITORY --json isDraft,url 2>$null
    if($LASTEXITCODE -eq 0){
        $release=$existing | ConvertFrom-Json
        if(!$release.isDraft){throw 'The release is already published; use a new tag'}
        gh release upload $env:RELEASE_TAG @($files.FullName) --repo $env:GITHUB_REPOSITORY --clobber
    } else {
        gh release create $env:RELEASE_TAG @($files.FullName) --repo $env:GITHUB_REPOSITORY --verify-tag --draft --prerelease --latest=false --title '魔都漫游体验版 · Android 0.4.1 / Windows 0.1.0' --notes-file "docs/releases/$env:RELEASE_TAG.md"
    }
    if($LASTEXITCODE -ne 0){throw 'Uploading the release assets failed'}
    $verifyDirectory=Join-Path $repositoryRoot 'windows/artifacts/release-download-check'
    New-Item -ItemType Directory -Force -Path $verifyDirectory | Out-Null
    gh release download $env:RELEASE_TAG --repo $env:GITHUB_REPOSITORY --dir $verifyDirectory --clobber
    if($LASTEXITCODE -ne 0){throw 'Unable to download staged release assets for verification'}
    foreach($file in $files){
        $downloaded=Join-Path $verifyDirectory $file.Name
        if(!(Test-Path -LiteralPath $downloaded) -or (Get-FileHash -LiteralPath $downloaded -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash){throw "Release asset verification failed: $($file.Name)"}
    }
    gh release edit $env:RELEASE_TAG --repo $env:GITHUB_REPOSITORY --draft=false --prerelease --latest=false
    if($LASTEXITCODE -ne 0){throw 'Release publication failed'}
    $published=gh release view $env:RELEASE_TAG --repo $env:GITHUB_REPOSITORY --json url,isDraft,isPrerelease,tagName,assets | ConvertFrom-Json
    if($LASTEXITCODE -ne 0 -or $published.isDraft -or !$published.isPrerelease){throw 'Release is not a published preview'}
    $published | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 'windows/artifacts/release-publication.json'
    Write-Output $published.url
} finally { Pop-Location }
