# Compare real-world speed: bqtj.top (Tencent EdgeOne) vs bqtj.pages.dev (Cloudflare direct).
# Usage (turn OFF any proxy / VPN first):
#   powershell -ExecutionPolicy Bypass -File tools\speed-check.ps1
#   powershell -ExecutionPolicy Bypass -File tools\speed-check.ps1 -N 10
#
# What it reports:
#   1. DNS: which EdgeOne edge IP you get (geo-locate it separately - HK is good, SG is a long haul)
#   2. TTFB (time to first byte) median for HTML on both domains
#   3. Cache status of a static asset (should be HIT on bqtj.top after the first hit)
#
# NOTE: results only mean something on a Chinese mainland network. If curl egresses
# through a VPN, both numbers are meaningless.

param([int]$N = 5)

function Get-Median($arr) {
  $s = @($arr | Sort-Object)
  $n = $s.Count
  if ($n -eq 0) { return 0 }
  if ($n % 2 -eq 1) { return $s[[int](($n - 1) / 2)] }
  return ($s[$n / 2 - 1] + $s[$n / 2]) / 2
}

function Probe([string]$url, [string]$label) {
  $ttfb = @()
  $code = ''
  $ip = ''
  for ($i = 0; $i -lt $N; $i++) {
    $out = & curl.exe --noproxy '*' -s -o NUL -m 20 -w '%{http_code} %{time_starttransfer} %{remote_ip}' $url
    $p = $out -split ' '
    if ($p.Count -ge 3) {
      $code = $p[0]
      $ttfb += [double]$p[1]
      $ip = $p[2]
    }
  }
  $ms = @($ttfb | ForEach-Object { [int]([math]::Round($_ * 1000)) })
  [pscustomobject]@{
    Target = $label
    Status = $code
    EdgeIP = $ip
    MedianMs = [int]([math]::Round((Get-Median $ttfb) * 1000))
    Runs = ($ms -join '/')
  }
}

Write-Output '=== 1. DNS: bqtj.top A records (what EdgeOne hands you) ==='
try {
  $a = Resolve-DnsName bqtj.top -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress
  Write-Output ($a -join ', ')
} catch {
  Write-Output ('resolve failed: ' + $_.Exception.Message)
}

Write-Output ''
Write-Output ('=== 2. TTFB, ' + $N + ' runs each (ms) ===')
$rows = @()
$rows += Probe 'https://bqtj.top/'               'bqtj.top   HTML'
$rows += Probe 'https://bqtj.pages.dev/'         'pages.dev  HTML'
$rows += Probe 'https://bqtj.top/assets/css/style.css?v=22'    'bqtj.top   CSS'
$rows += Probe 'https://bqtj.pages.dev/assets/css/style.css?v=22' 'pages.dev  CSS'
$rows | Format-Table -AutoSize | Out-String

Write-Output '=== 3. EdgeOne cache status (2nd hit should be HIT) ==='
1..2 | ForEach-Object {
  $h = & curl.exe --noproxy '*' -s -D - -o NUL 'https://bqtj.top/assets/css/style.css?v=22' |
       Select-String -Pattern 'EO-Cache-Status|^Age:'
  Write-Output ('try ' + $_ + ' -> ' + (($h | ForEach-Object { $_.ToString().Trim() }) -join ' | '))
}

Write-Output ''
Write-Output 'How to read this:'
Write-Output '  - EdgeOne IP in Hong Kong + lower TTFB than pages.dev  => acceleration is working'
Write-Output '  - EdgeOne IP in Singapore                              => you are routed on a long haul, gain is small'
Write-Output '  - CSS second hit = HIT                                 => cache is doing its job (no cross-border round trip)'
