$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$TomcatVersion = if ($env:TOMCAT_VERSION) { $env:TOMCAT_VERSION } else { "9.0.121" }
$Runtime = Join-Path $Root "runtime"
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $Runtime "tomcat"), (Join-Path $Runtime "java")
$Tmp = Join-Path $env:TEMP ("geoportal-desktop-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
try {
  $Zip = "apache-tomcat-$TomcatVersion.zip"
  $Url = "https://dlcdn.apache.org/tomcat/tomcat-9/v$TomcatVersion/bin/$Zip"
  Invoke-WebRequest -UseBasicParsing $Url -OutFile (Join-Path $Tmp $Zip)
  Invoke-WebRequest -UseBasicParsing "$Url.sha512" -OutFile (Join-Path $Tmp "$Zip.sha512")
  $Expected = ((Get-Content (Join-Path $Tmp "$Zip.sha512")) -split '\s+')[0].ToLower()
  $Actual = (Get-FileHash -Algorithm SHA512 (Join-Path $Tmp $Zip)).Hash.ToLower()
  if ($Expected -ne $Actual) { throw "Tomcat SHA-512 verification failed." }
  Expand-Archive -Path (Join-Path $Tmp $Zip) -DestinationPath $Tmp
  Move-Item (Join-Path $Tmp "apache-tomcat-$TomcatVersion") (Join-Path $Runtime "tomcat")
  Get-ChildItem (Join-Path $Runtime "tomcat\webapps") -Force | Remove-Item -Recurse -Force

  if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME "bin\jlink.exe"))) {
    throw "JAVA_HOME must point to JDK 17+ with jlink.exe."
  }
  & (Join-Path $env:JAVA_HOME "bin\jlink.exe") --add-modules java.se,jdk.unsupported,jdk.crypto.ec --strip-debug --no-header-files --no-man-pages --compress=2 --output (Join-Path $Runtime "java")
  Write-Host "Prepared Tomcat + Java runtime. GIS runtime is prepared separately by CI with conda-pack."
}
finally { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Tmp }
