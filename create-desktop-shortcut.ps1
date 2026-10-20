# Creates a direct Desktop shortcut for AI Bridge
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "AI Bridge.lnk"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronExe = Join-Path $ScriptDir "node_modules\electron\dist\electron.exe"
$VbsPath = Join-Path $ScriptDir "AiBridge.vbs"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)

if (Test-Path $ElectronExe) {
    # Direct GUI executable - 100% NO TERMINAL WINDOW EVER
    $Shortcut.TargetPath = $ElectronExe
    $Shortcut.Arguments = "`"$ScriptDir`""
    $Shortcut.WorkingDirectory = $ScriptDir
    $Shortcut.IconLocation = "$ElectronExe,0"
} else {
    # VBS silent wrapper
    $Shortcut.TargetPath = "wscript.exe"
    $Shortcut.Arguments = "`"$VbsPath`""
    $Shortcut.WorkingDirectory = $ScriptDir
}

$Shortcut.Description = "AI Bridge - Universal Web LLM Desktop Software"
$Shortcut.Save()

Write-Host "Desktop shortcut created successfully at: $ShortcutPath"
