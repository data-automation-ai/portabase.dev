$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $repo 'desktop\vendor'
$postgresTarget = Join-Path $vendor 'postgres\bin'

if (Test-Path -LiteralPath $vendor) {
  $resolvedVendor = [System.IO.Path]::GetFullPath($vendor)
  $resolvedDesktop = [System.IO.Path]::GetFullPath((Join-Path $repo 'desktop'))
  if (-not $resolvedVendor.StartsWith($resolvedDesktop, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe vendor path.' }
  Remove-Item -LiteralPath $vendor -Recurse -Force
}
New-Item -ItemType Directory -Path $postgresTarget -Force | Out-Null

$pgDump = (Get-Command pg_dump.exe -ErrorAction Stop).Source
$pgBin = Split-Path -Parent $pgDump
foreach ($required in 'pg_dump.exe','pg_dumpall.exe','psql.exe') {
  Copy-Item -LiteralPath (Join-Path $pgBin $required) -Destination $postgresTarget -Force
}
Get-ChildItem -LiteralPath $pgBin -Filter '*.dll' -File | Copy-Item -Destination $postgresTarget -Force
$pgRoot = Split-Path -Parent $pgBin
foreach ($notice in 'commandlinetools_3rd_party_licenses.txt','server_license.txt') {
  $source = Join-Path $pgRoot $notice
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $vendor "postgres\$notice") -Force }
}

$supabase = Get-ChildItem -LiteralPath (Join-Path $repo 'node_modules\@supabase') -Recurse -Filter 'supabase.exe' -File |
  Select-Object -First 1
if (-not $supabase) { throw 'The Windows Supabase CLI package is missing. Run npm install on Windows first.' }
Copy-Item -LiteralPath $supabase.FullName -Destination (Join-Path $vendor 'supabase.exe') -Force

foreach ($required in 'pg_dump.exe','pg_dumpall.exe','psql.exe') {
  if (-not (Test-Path -LiteralPath (Join-Path $postgresTarget $required))) { throw "Missing staged tool: $required" }
}
Write-Host "Staged PostgreSQL tools from $pgBin and the pinned Supabase CLI."
