$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [System.Environment]::GetFolderPath('Desktop')
$AppDir = $PSScriptRoot

$Shortcut = $WshShell.CreateShortcut("$Desktop\SENJU.lnk")
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = """$AppDir\launch-senju.vbs"""
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Launch SENJU"
$Shortcut.IconLocation = "$AppDir\assets\senju-icon.ico, 0"
$Shortcut.Save()
Write-Host "Desktop shortcut created for $AppDir"
