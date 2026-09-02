Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\vivek\.gemini\antigravity\brain\b59a1ab1-811e-492c-956d-caf5a93332f2\sexy_ai_logo_1783155132610.png'
$destIco = 'C:\Data\DVSC\assets\sexy-icon.ico'
$destPng = 'C:\Data\DVSC\assets\sexy-logo.png'

# Ensure assets dir exists
if (-not (Test-Path 'C:\Data\DVSC\assets')) {
    New-Item -ItemType Directory -Path 'C:\Data\DVSC\assets' | Out-Null
}

# Copy the PNG as app logo
Copy-Item $src $destPng -Force

# Convert PNG to ICO using System.Drawing
$img = [System.Drawing.Image]::FromFile($src)
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img, 0, 0, 256, 256)

$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.File]::Create($destIco)
$icon.Save($fs)
$fs.Close()

$g.Dispose()
$bmp.Dispose()
$img.Dispose()

Write-Host "Icon created at: $destIco"
Write-Host "Logo saved at: $destPng"
