<#
.SYNOPSIS
  Remove the LanChess logon auto-start Scheduled Task.

.DESCRIPTION
  Unregisters the task created by scripts\install-autostart.ps1 and (unless
  -KeepFirewallRule is given) removes the inbound firewall rule for TCP 27310.
  User data under the app's userData directory is left untouched.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1 -KeepFirewallRule
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'LanChessServer',
  [switch]$KeepFirewallRule
)

$ErrorActionPreference = 'Stop'
$port = 27310
$ruleName = "LanChess $port"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Scheduled task '$TaskName' removed."
} else {
  Write-Host "Scheduled task '$TaskName' not found (already removed?)."
}

if ($KeepFirewallRule) {
  Write-Host "Firewall rule kept: $ruleName"
  return
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  Write-Warning "Not elevated: firewall rule '$ruleName' was not removed."
  Write-Warning "Run as administrator to remove it: Remove-NetFirewallRule -DisplayName '$ruleName'"
  return
}

if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
  Remove-NetFirewallRule -DisplayName $ruleName
  Write-Host "Firewall rule removed: $ruleName"
} else {
  Write-Host "Firewall rule not found: $ruleName"
}
