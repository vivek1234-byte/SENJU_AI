Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
' Works from wherever the SENJU folder lives
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = appDir
electronExe = appDir & "\node_modules\electron\dist\electron.exe"
mcpSdk = appDir & "\node_modules\@modelcontextprotocol\sdk"

If fso.FileExists(electronExe) And fso.FolderExists(mcpSdk) Then
  ' Launch electron.exe directly (skips the cmd -> node -> electron chain, which added seconds)
  WshShell.Run """" & electronExe & """ """ & appDir & """", 1, False
Else
  ' Missing dependencies: the batch launcher installs them (visible window), then starts SENJU
  WshShell.Run "cmd /c """ & appDir & "\Start_SENJU.bat""", 1, False
End If
