Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = "C:\Data\SENJU"
WshShell.CurrentDirectory = appDir
electronExe = appDir & "\node_modules\electron\dist\electron.exe"

' Launch electron.exe directly (skips the cmd -> node -> electron chain, which added seconds)
If fso.FileExists(electronExe) Then
  WshShell.Run """" & electronExe & """ """ & appDir & """", 1, False
Else
  WshShell.Run "cmd /c """ & appDir & "\node_modules\.bin\electron.cmd"" .", 0, False
End If
