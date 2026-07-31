param(
  [Parameter(Mandatory = $true)]
  [string]$Executable
)

$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) ("Anima Studio 한글 " + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $smokeRoot | Out-Null
Copy-Item -LiteralPath (Resolve-Path $Executable) -Destination $smokeRoot
$exe = Join-Path $smokeRoot "AnimaStudio.exe"
$stdout = Join-Path $smokeRoot "stdout.log"
$stderr = Join-Path $smokeRoot "stderr.log"
$process = Start-Process -FilePath $exe -ArgumentList "--no-browser" -WorkingDirectory $smokeRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden

try {
  $descriptor = Join-Path $smokeRoot "data\_app\instance.json"
  $deadline = (Get-Date).AddMinutes(3)
  while (!(Test-Path -LiteralPath $descriptor) -and !$process.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (!(Test-Path -LiteralPath $descriptor)) {
    Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue
    Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue
    throw "Smoke instance descriptor missing. Files retained at $smokeRoot"
  }
  $instance = Get-Content -LiteralPath $descriptor | ConvertFrom-Json
  $base = "http://127.0.0.1:$($instance.port)"
  $rootResult = Invoke-WebRequest "$base/" -UseBasicParsing
  $health = Invoke-RestMethod "$base/api/health"
  $info = Invoke-RestMethod "$base/api/app/info"
  if ($rootResult.StatusCode -ne 200) { throw "UI failed" }
  if (!$health.ok) { throw "Health failed" }
  if ($info.port -ne $instance.port) { throw "Port mismatch" }
  if ($info.dataPath -ne (Join-Path $smokeRoot "data")) { throw "Data path mismatch" }
  $secondOutput = & $exe --no-browser
  if ($LASTEXITCODE -ne 0 -or $secondOutput -notmatch [regex]::Escape($base)) {
    throw "Second launch did not reuse the existing dynamic URL"
  }
  [pscustomobject]@{
    TemporaryDirectory = $smokeRoot
    ProcessId = $process.Id
    Port = $instance.port
    RootStatus = $rootResult.StatusCode
    ContentType = $rootResult.Headers["Content-Type"]
    Health = $health.ok
    Version = $info.version
    DataPath = $info.dataPath
    SecondLaunch = $secondOutput -join "`n"
  } | ConvertTo-Json
} finally {
  if (!$process.HasExited) { Stop-Process -Id $process.Id -Force }
  $process.WaitForExit(30000) | Out-Null
}
