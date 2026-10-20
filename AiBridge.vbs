Set WshShell = CreateObject("WScript.Shell")
strPath = WshShell.CurrentDirectory
WshShell.Run "cmd /c """ & strPath & "\AiBridge.bat""", 0, False
