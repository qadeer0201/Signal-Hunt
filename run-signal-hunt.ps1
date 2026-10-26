$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Backend = Join-Path $Root 'Backend'
$Requirements = Join-Path $Backend 'requirements.txt'
if (-not (Test-Path -LiteralPath $Requirements)) { throw "Signal Hunt requirements were not found at $Requirements" }

$Port = 8014
if ($env:SIGNAL_HUNT_PORT) {
  if ($env:SIGNAL_HUNT_PORT -notmatch '^\d{1,5}$') { throw 'SIGNAL_HUNT_PORT must be a port number from 1024 to 65535.' }
  $Port = [int]$env:SIGNAL_HUNT_PORT
}
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'SIGNAL_HUNT_PORT must be a port number from 1024 to 65535.' }
$Probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $Probe.Start() } catch { throw "Port $Port is already in use. Stop the other Signal Hunt window or choose another port with `$env:SIGNAL_HUNT_PORT = '8015'. No other application was stopped." }
finally { $Probe.Stop() }

$BaseCommand = $null
$BaseArguments = @()
$PythonVersion = $null
$Candidates = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
  $Candidates += [pscustomobject]@{ Command = 'py'; Arguments = @('-3.14') }
  $Candidates += [pscustomobject]@{ Command = 'py'; Arguments = @('-3.12') }
  $Candidates += [pscustomobject]@{ Command = 'py'; Arguments = @('-3.11') }
}
foreach ($name in @('python3.14', 'python3.12', 'python3.11', 'python')) {
  if (Get-Command $name -ErrorAction SilentlyContinue) { $Candidates += [pscustomobject]@{ Command = $name; Arguments = @() } }
}
$PythonCore314 = Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64\python.exe'
if (Test-Path -LiteralPath $PythonCore314) { $Candidates += [pscustomobject]@{ Command = $PythonCore314; Arguments = @() } }
foreach ($candidate in $Candidates) {
  $command = [string]$candidate.Command
  $arguments = @($candidate.Arguments)
  try {
    $versionText = (& $command @arguments --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $versionText -match 'Python\s+(\d+)\.(\d+)') {
      $major = [int]$Matches[1]; $minor = [int]$Matches[2]
      if ($major -eq 3 -and $minor -in @(11, 12, 14)) {
        $BaseCommand = $command; $BaseArguments = $arguments; $PythonVersion = "$major.$minor"; break
      }
    }
  } catch { }
}
if (-not $BaseCommand) { throw 'A compatible Python 3.11, 3.12 or 3.14 installation was not found. Install Python 3.12 from python.org, then run this script again.' }

$Venv = Join-Path $Backend '.venv'
$VenvPython = Join-Path $Venv 'Scripts\python.exe'
if (Test-Path -LiteralPath $VenvPython) {
  $venvVersion = (& $VenvPython --version 2>&1 | Out-String).Trim()
  if ($venvVersion -notmatch 'Python\s+3\.(11|12|14)\.') {
    $Venv = Join-Path $Backend ('.venv-signal-hunt-' + $PythonVersion)
    $VenvPython = Join-Path $Venv 'Scripts\python.exe'
    Write-Host "The existing .venv uses an unsupported Python version; keeping it untouched and using $Venv instead."
  }
}
if (-not (Test-Path -LiteralPath $VenvPython)) {
  Write-Host "Creating Signal Hunt's private Python $PythonVersion environment…"
  & $BaseCommand @BaseArguments -m venv $Venv
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $VenvPython)) { throw "Could not create the project's private Python environment at $Venv. Verify Python $PythonVersion is installed and try again." }
}

& $VenvPython -c 'import fastapi, uvicorn' 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Installing the missing Signal Hunt packages into its private environment (only needed once or after a requirements update)…'
  & $VenvPython -m pip install -r $Requirements
  if ($LASTEXITCODE -ne 0) { throw 'Dependency setup failed. Check your internet connection and rerun run-signal-hunt.ps1. If offline, connect to the internet for this first setup, then run the script again.' }
}

$DataDirectory = if ($env:SIGNAL_HUNT_DATA_DIR) { [System.IO.Path]::GetFullPath($env:SIGNAL_HUNT_DATA_DIR) } else { Join-Path $Root 'data' }
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$Database = Join-Path $DataDirectory 'signal-hunt.db'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Database) | Out-Null

$env:FRONTEND_DIR = Join-Path $Root 'Frontend'
$env:DATABASE_PATH = $Database
$env:BACKUP_DIRECTORY = Join-Path $DataDirectory 'backups'
$env:MAX_TEAMS = '10'
$env:STRICT_SECURITY = '1'
$env:SECURE_COOKIES = '0'
$env:PORT = [string]$Port
$env:PYTHONUNBUFFERED = '1'
$env:SIGNAL_HUNT_LOCAL_LAUNCH = '1'

$CredentialExists = $false
$CheckCredential = @'
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
r=c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='private_meta'").fetchone()
print('yes' if r and c.execute("SELECT 1 FROM private_meta WHERE key='organizer_password_hash'").fetchone() else 'no')
'@
try { $CredentialExists = ((& $VenvPython -c $CheckCredential $Database 2>$null | Out-String).Trim() -eq 'yes') } catch { $CredentialExists = $false }
$SetLocalPassword = $false
if (-not $env:ADMIN_PASSWORD -and -not $CredentialExists) {
  $SecurePassword = Read-Host -AsSecureString 'Create your local organizer password (at least 12 characters; saved as a salted hash)'
  $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
  try { $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
  if ($env:ADMIN_PASSWORD.Length -lt 12) { Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue; throw 'Use an organizer password with at least 12 characters.' }
  $SetLocalPassword = $true
}
if (-not $CredentialExists -and $env:ADMIN_PASSWORD) { $SetLocalPassword = $true }
if ($SetLocalPassword) { $env:LOCAL_CREDENTIAL_SETUP = '1' }

Write-Host ''
Write-Host 'SIGNAL HUNT is ready.'
Write-Host "Website: http://127.0.0.1:$Port/"
Write-Host "Organizer dashboard: http://127.0.0.1:$Port/host.html"
Write-Host "Port: $Port | Python: $PythonVersion | Event data: $Database"
Write-Host 'Keep this window open while using the website. Press Ctrl+C to stop the server.'
Write-Host ''
Push-Location $Backend
try {
  & $VenvPython -m uvicorn app.main:app --host 127.0.0.1 --port $Port
  if ($LASTEXITCODE -ne 0) { throw "Signal Hunt stopped with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
  if ($SetLocalPassword) { Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue }
  Remove-Item Env:LOCAL_CREDENTIAL_SETUP -ErrorAction SilentlyContinue
}
