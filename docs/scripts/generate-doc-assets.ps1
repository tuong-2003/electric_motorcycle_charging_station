$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$demo = Join-Path $root "ket-qua-demo"
New-Item -ItemType Directory -Force $demo | Out-Null

Add-Type -AssemblyName System.Drawing

function New-Canvas {
    param([int]$Width, [int]$Height, [string]$Back = "#F8FAFC")
    $bmp = New-Object System.Drawing.Bitmap $Width, $Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml($Back))
    return @{ Bitmap = $bmp; Graphics = $g }
}

function FontObj([float]$size, [int]$style = 0) {
    return New-Object System.Drawing.Font "Segoe UI", $size, ([System.Drawing.FontStyle]$style)
}

function Brush([string]$color) {
    return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))
}

function PenObj([string]$color, [float]$width = 1) {
    return New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($color)), $width
}

function Draw-RoundedRect {
    param($g, [int]$x, [int]$y, [int]$w, [int]$h, [int]$r, [string]$fill, [string]$stroke = "#CBD5E1")
    if ($r -le 0) {
        $g.FillRectangle((Brush $fill), $x, $y, $w, $h)
        $g.DrawRectangle((PenObj $stroke 1), $x, $y, $w, $h)
        return
    }
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath((Brush $fill), $path)
    $g.DrawPath((PenObj $stroke 1), $path)
}

function Draw-Text {
    param($g, [string]$text, [int]$x, [int]$y, [float]$size = 14, [string]$color = "#0F172A", [int]$style = 0)
    $g.DrawString($text, (FontObj $size $style), (Brush $color), $x, $y)
}

function Draw-LineArrow {
    param($g, [int]$x1, [int]$y1, [int]$x2, [int]$y2, [string]$color = "#334155")
    $pen = PenObj $color 3
    $cap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap 5, 5
    $pen.CustomEndCap = $cap
    $g.DrawLine($pen, $x1, $y1, $x2, $y2)
}

function Save-Png($bmp, [string]$path) {
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Save-Jpg($bmp, [string]$path) {
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
}

# So do he thong
$c = New-Canvas 1400 820 "#F8FAFC"
$g = $c.Graphics
Draw-Text $g "Kien truc he thong tram sac xe dien" 360 34 28 "#0F172A" 1
Draw-Text $g "Modbus RTU/RS485 -> MQTT -> Backend/API -> Web/App" 438 76 14 "#475569" 0

Draw-RoundedRect $g 70 190 250 160 16 "#FFFFFF" "#94A3B8"
Draw-Text $g "Station ESP32" 118 215 20 "#065F46" 1
Draw-Text $g "Relay 2 cong sac" 115 255 13 "#334155"
Draw-Text $g "PZEM-004T, DHT11" 115 282 13 "#334155"
Draw-Text $g "TFT ST7735 + QR" 115 309 13 "#334155"

Draw-RoundedRect $g 420 190 250 160 16 "#FFFFFF" "#94A3B8"
Draw-Text $g "Gateway ESP32" 464 215 20 "#1D4ED8" 1
Draw-Text $g "Modbus Master" 475 255 13 "#334155"
Draw-Text $g "WiFi + MQTT Client" 475 282 13 "#334155"
Draw-Text $g "Poll moi 5 giay" 475 309 13 "#334155"

Draw-RoundedRect $g 770 190 250 160 16 "#FFFFFF" "#94A3B8"
Draw-Text $g "MQTT Broker" 817 215 20 "#7C2D12" 1
Draw-Text $g "ev_station/+/outlet/+/status" 800 255 12 "#334155"
Draw-Text $g "ev_station/+/outlet/+/cmd" 803 282 12 "#334155"
Draw-Text $g "ev_station/+/config" 837 309 12 "#334155"

Draw-RoundedRect $g 1070 190 250 160 16 "#FFFFFF" "#94A3B8"
Draw-Text $g "Backend Node.js" 1110 215 20 "#BE123C" 1
Draw-Text $g "Express API + JWT" 1120 255 13 "#334155"
Draw-Text $g "Worker tinh tien" 1120 282 13 "#334155"
Draw-Text $g "Webhook nap tien" 1120 309 13 "#334155"

Draw-LineArrow $g 320 270 420 270
Draw-Text $g "RS485" 350 240 12 "#475569"
Draw-LineArrow $g 670 270 770 270
Draw-Text $g "MQTT" 704 240 12 "#475569"
Draw-LineArrow $g 1020 270 1070 270

Draw-RoundedRect $g 270 520 250 150 16 "#ECFDF5" "#10B981"
Draw-Text $g "Mobile App" 338 546 20 "#065F46" 1
Draw-Text $g "Quet QR, vi tien, lich su" 305 586 13 "#334155"
Draw-Text $g "Bat/dung phien sac" 325 613 13 "#334155"

Draw-RoundedRect $g 610 520 250 150 16 "#EFF6FF" "#3B82F6"
Draw-Text $g "Web Admin" 682 546 20 "#1D4ED8" 1
Draw-Text $g "Dashboard, cau hinh tram" 640 586 13 "#334155"
Draw-Text $g "Quan ly user va lich su" 645 613 13 "#334155"

Draw-RoundedRect $g 950 520 250 150 16 "#FFF7ED" "#F97316"
Draw-Text $g "MySQL" 1042 546 20 "#9A3412" 1
Draw-Text $g "users, stations" 1000 586 13 "#334155"
Draw-Text $g "telemetry, sessions, topup" 985 613 13 "#334155"

Draw-LineArrow $g 1070 350 520 520 "#64748B"
Draw-LineArrow $g 1130 350 860 520 "#64748B"
Draw-LineArrow $g 1195 350 1080 520 "#64748B"
Save-Png $c.Bitmap (Join-Path $root "so-do-he-thong.png")
$g.Dispose(); $c.Bitmap.Dispose()

# So do ket noi
$c = New-Canvas 1400 900 "#F8FAFC"
$g = $c.Graphics
Draw-Text $g "So do ket noi phan cung Station va Gateway" 350 34 28 "#0F172A" 1

Draw-RoundedRect $g 560 210 280 220 18 "#FFFFFF" "#0F766E"
Draw-Text $g "ESP32 Station" 630 238 22 "#0F766E" 1
Draw-Text $g "GPIO 21/22 -> Relay" 610 282 13 "#334155"
Draw-Text $g "GPIO 4 -> DHT11" 610 309 13 "#334155"
Draw-Text $g "RX18/TX19 -> RS485" 610 336 13 "#334155"
Draw-Text $g "SPI -> TFT ST7735" 610 363 13 "#334155"
Draw-Text $g "UART -> PZEM x2" 610 390 13 "#334155"

$boxes = @(
    @{x=80;y=150;w=240;h=110;t="Relay 2 kenh";d="Dong/ngat cong sac 1-2";c="#FEF2F2";s="#EF4444"},
    @{x=80;y=330;w=240;h=110;t="PZEM-004T x2";d="Do V/A/W tung cong";c="#FFF7ED";s="#F97316"},
    @{x=80;y=510;w=240;h=110;t="DHT11";d="Nhiet do, do am";c="#ECFDF5";s="#10B981"},
    @{x=1080;y=150;w=240;h=110;t="TFT ST7735";d="QR + trang thai sac";c="#EFF6FF";s="#3B82F6"},
    @{x=1080;y=330;w=240;h=110;t="RS485 Module";d="Modbus RTU bus";c="#F8FAFC";s="#64748B"},
    @{x=1080;y=510;w=240;h=110;t="OTA AP";d="EV_Station_OTA";c="#FDF2F8";s="#DB2777"}
)
foreach ($b in $boxes) {
    Draw-RoundedRect $g $b.x $b.y $b.w $b.h 14 $b.c $b.s
    Draw-Text $g $b.t ($b.x + 34) ($b.y + 24) 18 $b.s 1
    Draw-Text $g $b.d ($b.x + 30) ($b.y + 62) 12 "#334155"
}

Draw-LineArrow $g 320 205 560 270
Draw-LineArrow $g 320 385 560 330
Draw-LineArrow $g 320 565 560 385
Draw-LineArrow $g 840 270 1080 205
Draw-LineArrow $g 840 330 1080 385
Draw-LineArrow $g 840 385 1080 565

Draw-RoundedRect $g 545 650 310 120 16 "#FFFFFF" "#1D4ED8"
Draw-Text $g "ESP32 Gateway" 625 676 21 "#1D4ED8" 1
Draw-Text $g "RS485 RX18/TX19 + WiFi MQTT" 595 720 13 "#334155"
Draw-LineArrow $g 720 430 720 650 "#334155"
Draw-Text $g "RS485 bus" 742 520 13 "#475569"
Save-Png $c.Bitmap (Join-Path $root "so-do-ket-noi.png")
$g.Dispose(); $c.Bitmap.Dispose()

# Dashboard demo
$c = New-Canvas 1440 900 "#F1F5F9"
$g = $c.Graphics
Draw-RoundedRect $g 0 0 240 900 0 "#111827" "#111827"
Draw-Text $g "HVT Station" 36 32 22 "#FFFFFF" 1
Draw-Text $g "Tong quan" 36 100 15 "#D1D5DB"
Draw-Text $g "Tram sac" 36 150 15 "#D1D5DB"
Draw-Text $g "Nguoi dung" 36 200 15 "#D1D5DB"
Draw-Text $g "Lich su" 36 250 15 "#D1D5DB"
Draw-Text $g "Dashboard quan tri tram sac" 290 34 26 "#0F172A" 1
Draw-Text $g "Du lieu minh hoa - thay bang anh chup thuc te khi demo" 292 72 13 "#64748B"
$stats = @(
    @{x=290;t="Tong cong suat";v="1129 W";c="#10B981"},
    @{x=560;t="Cong dang sac";v="1 / 2";c="#3B82F6"},
    @{x=830;t="Nhiet do";v="34 C";c="#F97316"},
    @{x=1100;t="Canh bao";v="0";c="#EF4444"}
)
foreach ($s in $stats) {
    Draw-RoundedRect $g $s.x 120 230 120 12 "#FFFFFF" "#E2E8F0"
    Draw-Text $g $s.t ($s.x+24) 146 13 "#64748B"
    Draw-Text $g $s.v ($s.x+24) 176 28 $s.c 1
}
Draw-RoundedRect $g 290 300 1040 460 14 "#FFFFFF" "#E2E8F0"
Draw-Text $g "Danh sach tu sac" 318 330 19 "#0F172A" 1
$rows = @("001.1    CHARGING     220.5 V     5.12 A     1128.9 W", "001.2    AVAILABLE      0.0 V      0.00 A        0.0 W")
$y = 390
foreach ($r in $rows) {
    Draw-RoundedRect $g 320 $y 960 72 8 "#F8FAFC" "#E2E8F0"
    Draw-Text $g $r 350 ($y+24) 16 "#334155"
    $y += 96
}
Save-Png $c.Bitmap (Join-Path $demo "dashboard.png")
$g.Dispose(); $c.Bitmap.Dispose()

# Mobile demo
$c = New-Canvas 900 1200 "#E2E8F0"
$g = $c.Graphics
Draw-RoundedRect $g 275 70 350 980 28 "#F8FAFC" "#0F172A"
Draw-Text $g "Tram Sac Xe Dien" 330 125 24 "#0F172A" 1
Draw-RoundedRect $g 315 190 270 140 16 "#FFFFFF" "#E2E8F0"
Draw-Text $g "So du vi" 405 215 14 "#64748B"
Draw-Text $g "125,000 d" 365 250 32 "#10B981" 1
Draw-RoundedRect $g 315 370 270 96 14 "#ECFDF5" "#10B981"
Draw-Text $g "Quet QR de sac" 370 400 18 "#065F46" 1
Draw-Text $g "001.1 / 001.2" 392 430 13 "#334155"
Draw-Text $g "Danh sach tram" 315 520 18 "#0F172A" 1
Draw-RoundedRect $g 315 565 270 110 12 "#FFFFFF" "#E2E8F0"
Draw-Text $g "Tu sac 001" 340 590 17 "#0F172A" 1
Draw-Text $g "1 cong dang sac, 1 cong san sang" 340 622 12 "#64748B"
Draw-RoundedRect $g 315 710 270 110 12 "#FFFFFF" "#E2E8F0"
Draw-Text $g "Lich su gan day" 340 735 17 "#0F172A" 1
Draw-Text $g "0.42 kWh - 1,470 d" 340 767 12 "#64748B"
Draw-RoundedRect $g 315 930 270 70 16 "#FFFFFF" "#CBD5E1"
Draw-Text $g "Home        History        Account" 342 956 13 "#334155"
Save-Png $c.Bitmap (Join-Path $demo "mobile-app.png")
$g.Dispose(); $c.Bitmap.Dispose()

# Station LCD demo JPG
$c = New-Canvas 1000 700 "#111827"
$g = $c.Graphics
Draw-RoundedRect $g 250 120 500 360 18 "#020617" "#475569"
Draw-RoundedRect $g 280 150 440 300 8 "#000000" "#334155"
$g.FillRectangle((Brush "#1D4ED8"), 280, 150, 440, 44)
Draw-Text $g "MODBUS                 34C 62%" 300 163 15 "#FFFFFF" 1
Draw-Text $g "001.1" 315 210 16 "#FACC15" 1
Draw-Text $g "001.2" 535 210 16 "#FACC15" 1
Draw-RoundedRect $g 315 245 120 120 4 "#FFFFFF" "#FFFFFF"
Draw-RoundedRect $g 535 245 120 120 4 "#FFFFFF" "#FFFFFF"
for ($i=0; $i -lt 6; $i++) {
    $g.FillRectangle((Brush "#000000"), 330 + $i*16, 260, 8, 8)
    $g.FillRectangle((Brush "#000000"), 550 + $i*14, 275 + $i*10, 8, 8)
}
Draw-Text $g "CHARGING" 315 385 16 "#22C55E" 1
Draw-Text $g "AVAILABLE" 535 385 16 "#22D3EE" 1
Draw-Text $g "220V 5.12A" 315 415 13 "#FFFFFF"
Draw-Text $g "0V 0.00A" 535 415 13 "#FFFFFF"
Draw-Text $g "Anh minh hoa man hinh TFT station" 330 530 18 "#CBD5E1"
Save-Jpg $c.Bitmap (Join-Path $demo "station-lcd.jpg")
$g.Dispose(); $c.Bitmap.Dispose()

# Serial monitor demo
$c = New-Canvas 1300 760 "#0B1020"
$g = $c.Graphics
Draw-Text $g "Serial Monitor - Gateway / Station" 40 34 24 "#E5E7EB" 1
$logs = @(
    "[WiFi] Connected! IP: 192.168.1.25",
    "[MQTT] Connected broker.hivemq.com:1883",
    "Doc thanh cong TRAM 1: V=220.5",
    "Publish ev_station/001/outlet/1/status {CHARGING, 220.5V, 5.12A}",
    "Gateway nhan lenh BAT cho TRAM 1 - O 1",
    "Modbus write REG_CMD_OUTLET1 = 1",
    "Station updateTelemetry temp=34 hum=62 outlet1=CHARGING",
    "Backend saved telemetry and updated charging session"
)
$y=100
foreach ($l in $logs) {
    Draw-Text $g $l 60 $y 18 "#A7F3D0"
    $y += 58
}
Save-Png $c.Bitmap (Join-Path $demo "serial-monitor.png")
$g.Dispose(); $c.Bitmap.Dispose()

# Minimal PDF bao cao, ASCII-safe text for broad compatibility
$pdfPath = Join-Path $root "bao-cao-do-an.pdf"
$contentLines = @(
    "Bao cao do an: He thong tram sac xe dien thong minh",
    "",
    "Muc tieu: xay dung mo hinh tram sac xe dien co giam sat, dieu khien",
    "va thanh toan qua ung dung.",
    "",
    "Thanh phan: ESP32 Station, ESP32 Gateway, Node.js Backend, MySQL,",
    "Web Admin va Mobile App Expo.",
    "",
    "Giao tiep: Station <-> Gateway bang Modbus RTU/RS485; Gateway <->",
    "Backend bang MQTT; Web/App <-> Backend bang REST API.",
    "",
    "Tinh nang: do V/A/W, nhiet do, do am; hien thi QR tren TFT; dieu",
    "khien relay 2 cong sac; quan ly user, vi tien, phien sac va nap tien.",
    "",
    "Ket qua: he thong hoat dong duoc theo luong IoT hai chieu, co dashboard",
    "quan tri, app nguoi dung, co che bao ve qua dong/qua nhiet/mat ket noi.",
    "",
    "Xem them: README.md, docs/phu-luc.md va cac hinh trong docs/ket-qua-demo."
)

function Escape-PdfText([string]$s) {
    return $s.Replace("\", "\\").Replace("(", "\(").Replace(")", "\)")
}

$streamText = "BT`n/F1 16 Tf`n50 790 Td`n"
$first = $true
foreach ($line in $contentLines) {
    if ($first) { $first = $false } else { $streamText += "0 -28 Td`n" }
    $streamText += "(" + (Escape-PdfText $line) + ") Tj`n"
}
$streamText += "ET`n"
$streamBytes = [System.Text.Encoding]::ASCII.GetBytes($streamText)
$len = $streamBytes.Length

$objects = New-Object System.Collections.Generic.List[string]
$objects.Add("1 0 obj`n<< /Type /Catalog /Pages 2 0 R >>`nendobj`n")
$objects.Add("2 0 obj`n<< /Type /Pages /Kids [3 0 R] /Count 1 >>`nendobj`n")
$objects.Add("3 0 obj`n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`nendobj`n")
$objects.Add("4 0 obj`n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`nendobj`n")
$objects.Add("5 0 obj`n<< /Length $len >>`nstream`n$streamText`nendstream`nendobj`n")

$bytes = New-Object System.Collections.Generic.List[byte]
function Add-Ascii([string]$s) {
    $bytes.AddRange([System.Text.Encoding]::ASCII.GetBytes($s))
}

Add-Ascii "%PDF-1.4`n"
$offsets = @(0)
foreach ($obj in $objects) {
    $offsets += $bytes.Count
    Add-Ascii $obj
}
$xref = $bytes.Count
Add-Ascii "xref`n0 6`n"
Add-Ascii "0000000000 65535 f `n"
for ($i=1; $i -le 5; $i++) {
    Add-Ascii ("{0:D10} 00000 n `n" -f $offsets[$i])
}
Add-Ascii "trailer`n<< /Size 6 /Root 1 0 R >>`nstartxref`n$xref`n%%EOF`n"
[System.IO.File]::WriteAllBytes($pdfPath, $bytes.ToArray())

Write-Host "Generated docs assets in $root"
