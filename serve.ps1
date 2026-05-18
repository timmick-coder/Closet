$port = 8080
$root = $PSScriptRoot

# Parse .env
$envVars = @{}
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*)\s*$') {
            $envVars[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "StyleSync running on http://localhost:$port"

while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $res  = $ctx.Response
    $path = $req.Url.LocalPath

    if ($path -eq '/env.js') {
        $js = "window.__ENV = {`n"
        foreach ($key in $envVars.Keys) {
            $val = $envVars[$key] -replace "'", "\'"
            $js += "  '$key': '$val',`n"
        }
        $js += "};`n"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($js)
        $res.ContentType = 'application/javascript; charset=utf-8'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
        $file = Join-Path $root $path.TrimStart('/')
        if (Test-Path $file -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $res.ContentType = switch ([System.IO.Path]::GetExtension($file)) {
                '.html' { 'text/html; charset=utf-8' }
                '.css'  { 'text/css' }
                '.js'   { 'application/javascript' }
                '.json' { 'application/json' }
                '.png'  { 'image/png' }
                '.jpg'  { 'image/jpeg' }
                default { 'application/octet-stream' }
            }
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
        }
    }
    $res.Close()
}
