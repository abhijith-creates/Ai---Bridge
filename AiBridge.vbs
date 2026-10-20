Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
strDir = fso.GetParentFolderName(WScript.ScriptFullName)

electronExe = strDir & "\node_modules\electron\dist\electron.exe"

If fso.FileExists(electronExe) Then
    WshShell.CurrentDirectory = strDir
    WshShell.Run """" & electronExe & """ """ & strDir & """", 1, False
Else
    WshShell.Run "cmd /c """ & strDir & "\AiBridge.bat""", 0, False
End If
