<?php
/**
 * KPay egress proxy for cPanel (fixed outbound IP)
 *
 * Upload to your cPanel public_html (or a subfolder), e.g.:
 *   https://YOUR-DOMAIN.com/kpay-egress-proxy.php
 *
 * Setup:
 * 1. Set PROXY_SECRET below to a long random string (same as KPAY_EGRESS_PROXY_SECRET in Vercel).
 * 2. Visit ?action=ip  → note the outbound IP → send that to KPay for whitelist.
 * 3. In Vercel / .env:
 *      KPAY_EGRESS_PROXY_URL=https://YOUR-DOMAIN.com/kpay-egress-proxy.php
 *      KPAY_EGRESS_PROXY_SECRET=<same secret>
 *
 * Only allowlisted KPay hosts can be targeted (UAT + prod).
 */

declare(strict_types=1);

// ========== CONFIG (edit on cPanel) ==========
// Generate: openssl rand -hex 32
const PROXY_SECRET = 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET';

// Hosts we are allowed to forward to (no open proxy)
const ALLOWED_HOSTS = [
    'payment.uat.kpay-group.com',
    'payment.kpay-group.com',
    'online-sandbox.kpay-group.com',
];

// Optional: only accept calls from these CIDRs later if needed (leave empty = secret only)
const ALLOWED_SOURCE_IPS = [
    // e.g. '1.2.3.4',
];
// ============================================

header('X-Content-Type-Options: nosniff');

$action = isset($_GET['action']) ? (string) $_GET['action'] : '';

// --- Discover this server's outbound IP (what KPay will see) ---
if ($action === 'ip') {
    header('Content-Type: application/json; charset=utf-8');
    $ip = fetchOutboundIp();
    echo json_encode([
        'ok' => $ip !== null,
        'outboundIp' => $ip,
        'serverAddr' => $_SERVER['SERVER_ADDR'] ?? null,
        'note' => 'Send outboundIp to KPay for production whitelist. Redeploy/move host may change it on shared cPanel.',
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

// --- Health (no secret; does not proxy) ---
if ($action === 'health' || $_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => true,
        'service' => 'kpay-egress-proxy',
        'secretConfigured' => PROXY_SECRET !== 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET',
        'allowedHosts' => ALLOWED_HOSTS,
        'hint' => 'GET ?action=ip for outbound IP. POST JSON to proxy KPay requests.',
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

// --- Proxy (POST only) ---
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'POST only for proxy']);
    exit;
}

$secret = $_SERVER['HTTP_X_EGRESS_SECRET']
    ?? $_SERVER['HTTP_X_PROXY_SECRET']
    ?? '';

if (PROXY_SECRET === 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET') {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Set PROXY_SECRET in kpay-egress-proxy.php']);
    exit;
}

if (!hash_equals(PROXY_SECRET, (string) $secret)) {
    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
    exit;
}

if (ALLOWED_SOURCE_IPS) {
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    if (!in_array($remote, ALLOWED_SOURCE_IPS, true)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'error' => 'Source IP not allowed', 'remote' => $remote]);
        exit;
    }
}

$rawIn = file_get_contents('php://input') ?: '';
$payload = json_decode($rawIn, true);
if (!is_array($payload)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'JSON body required']);
    exit;
}

$method = strtoupper((string) ($payload['method'] ?? 'POST'));
if (!in_array($method, ['GET', 'POST'], true)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'method must be GET or POST']);
    exit;
}

$targetUrl = (string) ($payload['url'] ?? '');
if ($targetUrl === '' || !filter_var($targetUrl, FILTER_VALIDATE_URL)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'valid url required']);
    exit;
}

$parts = parse_url($targetUrl);
$host = strtolower((string) ($parts['host'] ?? ''));
$scheme = strtolower((string) ($parts['scheme'] ?? ''));

if ($scheme !== 'https') {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'only https targets allowed']);
    exit;
}

if (!in_array($host, ALLOWED_HOSTS, true)) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'host not allowlisted', 'host' => $host]);
    exit;
}

$fwdHeaders = $payload['headers'] ?? [];
if (!is_array($fwdHeaders)) {
    $fwdHeaders = [];
}

// Only forward safe / KPay-related headers
$curlHeaders = [];
foreach ($fwdHeaders as $k => $v) {
    $name = (string) $k;
    $val = is_scalar($v) ? (string) $v : '';
    if ($val === '') {
        continue;
    }
    $lk = strtolower($name);
    if (
        $lk === 'content-type'
        || $lk === 'accept'
        || str_starts_with($lk, 'k-')
    ) {
        $curlHeaders[] = $name . ': ' . $val;
    }
}

$body = $payload['body'] ?? '';
if (!is_string($body)) {
    $body = $body === null ? '' : json_encode($body);
}

$ch = curl_init($targetUrl);
if ($ch === false) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'curl_init failed']);
    exit;
}

curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_TIMEOUT => 60,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_HTTPHEADER => $curlHeaders,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_FOLLOWLOCATION => false,
]);

if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
$errno = curl_errno($ch);
$errstr = curl_error($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

if ($response === false || $errno) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode([
        'ok' => false,
        'error' => 'upstream curl failed',
        'curlErrno' => $errno,
        'curlError' => $errstr,
    ]);
    exit;
}

$respHeadersRaw = substr((string) $response, 0, $headerSize);
$respBody = substr((string) $response, $headerSize);

// Pass through upstream status + body (JSON as-is from KPay)
http_response_code($httpCode > 0 ? $httpCode : 502);
// Prefer upstream content-type if present
$contentType = 'application/json; charset=utf-8';
if (preg_match('/^Content-Type:\s*(.+)$/mi', $respHeadersRaw, $m)) {
    $contentType = trim($m[1]);
}
header('Content-Type: ' . $contentType);
header('X-Egress-Proxy: cpanel');
header('X-Egress-Upstream-Status: ' . $httpCode);
echo $respBody;
exit;

// ---------- helpers ----------

function fetchOutboundIp(): ?string
{
    $urls = [
        'https://api.ipify.org?format=json',
        'https://ifconfig.me/ip',
    ];
    foreach ($urls as $u) {
        $ch = curl_init($u);
        if ($ch === false) {
            continue;
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $out = curl_exec($ch);
        curl_close($ch);
        if (!is_string($out) || $out === '') {
            continue;
        }
        $out = trim($out);
        if (str_starts_with($out, '{')) {
            $j = json_decode($out, true);
            if (is_array($j) && !empty($j['ip'])) {
                return (string) $j['ip'];
            }
        }
        if (filter_var($out, FILTER_VALIDATE_IP)) {
            return $out;
        }
    }
    return null;
}

// polyfill for older PHP
if (!function_exists('str_starts_with')) {
    function str_starts_with(string $haystack, string $needle): bool
    {
        return $needle === '' || strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}
