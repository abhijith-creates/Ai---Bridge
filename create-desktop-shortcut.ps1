# Creates a Desktop shortcut for AI Bridge
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "AI Bridge.lnk"



$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TargetPath = Join-Path $ScriptDir "AiBridge.vbs"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$TargetPath`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.Description = "AI Bridge - Universal Web LLM Desktop Software"

$Shortcut.Save()
Write-Host "Desktop shortcut created successfully at: $ShortcutPath"
