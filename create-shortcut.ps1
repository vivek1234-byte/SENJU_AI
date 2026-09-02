$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [System.Environment]::GetFolderPath('Desktop')

$Shortcut = $WshShell.CreateShortcut("$Desktop\SENJU.lnk")
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = """C:\Data\SEXY\launch-sexy.vbs"""
$Shortcut.WorkingDirectory = "C:\Data\SEXY"
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Launch SENJU"
$Shortcut.IconLocation = "C:\Data\SEXY\assets\senju-icon.ico, 0"
$Shortcut.Save()
Write-Host "Desktop shortcut updated with new path!"
