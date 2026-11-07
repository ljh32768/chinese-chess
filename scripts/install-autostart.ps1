<#
.SYNOPSIS
  Register the installed LanChess desktop app as a logon auto-start LAN server.

.DESCRIPTION
  Creates a per-user Scheduled Task that runs "LanChess.exe --server" at logon.
  The headless server listens on the fixed port 27310, stores data under the
  app's userData directory and writes logs to <userData>\logs\server.log.

  No administrator rights are required. The optional inbound firewall rule
  (TCP 27310) does need an elevated shell; otherwise the script prints the
  command to run as administrator.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -ExePath "D:\Apps\LanChess\LanChess.exe"
#>
[CmdletBinding()]
param(
  [string]$ExePath,
  [string]$TaskName = 'LanChessServer'
)

$ErrorActionPreference = 'Stop'
$port = 27310
$ruleName = "LanChess $port"

# Locate the installed executable: explicit hint first, then the uninstall registry entries,
# then the electron-builder per-user default location.
function Find-LanChessExe {
  param([string]$Hint)

  if ($Hint) {
    $resolved = (Resolve-Path -LiteralPath $Hint -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
      throw "Not a file: $resolved"
    }
    return $resolved
  }

  $uninstallRoots = @(
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($root in $uninstallRoots) {
    $entries = Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like 'LanChess*' }
    foreach ($entry in $entries) {
      if ($entry.InstallLocation) {
        $candidate = Join-Path $entry.InstallLocation 'LanChess.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
          return $candidate
        }
      }
      if ($entry.DisplayIcon) {
        $icon = ($entry.DisplayIcon -replace ',\d+$', '').Trim('"')
        if ($icon -like '*LanChess.exe' -and (Test-Path -LiteralPath $icon -PathType Leaf)) {
          return $icon
        }
      }
    }
  }

  $fallback = Join-Path $env:LOCALAPPDATA 'Programs\LanChess\LanChess.exe'
  if (Test-Path -LiteralPath $fallback -PathType Leaf) {
    return $fallback
  }
  throw 'LanChess.exe not found. Install the desktop app first, or pass -ExePath <path>.'
}

$exe = Find-LanChessExe -Hint $ExePath
$installDir = Split-Path -Parent $exe

$action = New-ScheduledTaskAction -Execute $exe -Argument '--server' -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "LanChess LAN server (headless, TCP $port)" `
  -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered: $exe --server"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if ($isAdmin) {
  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Write-Host "Firewall rule already exists: $ruleName"
  } else {
    New-NetFirewallRule `
      -DisplayName $ruleName `
      -Direction Inbound `
      -Protocol TCP `
      -LocalPort $port `
      -Action Allow | Out-Null
    Write-Host "Firewall rule added: inbound TCP $port"
  }
} else {
  Write-Warning "Not elevated: LAN clients may be blocked. Ask an administrator to run:"
  Write-Warning "  New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow"
}

Start-ScheduledTask -TaskName $TaskName
Write-Host "Task started. Log: %APPDATA%\lan-chess\logs\server.log"
