$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Micromamba = if ($env:MICROMAMBA) { $env:MICROMAMBA } else { "micromamba" }
$Tmp = Join-Path $env:TEMP ("geoportal-gis-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
try {
  $EnvDir = Join-Path $Tmp "env"
  & $Micromamba create -y -p $EnvDir -c conda-forge python=3.11 gdal pdal conda-pack
  if ($LASTEXITCODE -ne 0) { throw "micromamba environment creation failed." }
  & $Micromamba run -p $EnvDir conda-pack -p $EnvDir -o (Join-Path $Root "runtime\gis-runtime.tar.gz") --force
  if ($LASTEXITCODE -ne 0) { throw "conda-pack failed." }
  Get-Item (Join-Path $Root "runtime\gis-runtime.tar.gz")
}
finally { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Tmp }
