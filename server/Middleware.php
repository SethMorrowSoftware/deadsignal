<?php
/**
 * Middleware — what runs before a route handler.
 *
 *   setJsonHeaders()      JSON + security headers on every response
 *   parseJsonBody()       decode the request body into $GLOBALS['requestBody']
 *   requireCsrf()         demand X-Requested-With on mutating requests
 *   auth(bool $required)  resolve the Bearer token to an account
 *   rateLimit($n, $win)   sliding window per IP + path
 *
 * There is no requireRole(): every signed-in account has identical rights in
 * this backend, and who may touch a given project is decided per project by
 * StudioShare. A role check here would be a second, weaker answer to a question
 * that already has one.
 */
class Middleware
{
    public static function setJsonHeaders(): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        header('Cache-Control: no-store');
    }

    /** Decode the JSON body. Multipart is left to $_POST / $_FILES. */
    public static function parseJsonBody(): callable
    {
        return static function (array $params): void {
            $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
            if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) return;

            $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
            if (str_starts_with($contentType, 'multipart/form-data')) {
                $GLOBALS['requestBody'] = $_POST;
                return;
            }

            $raw = $GLOBALS['RAW_REQUEST_BODY'] ?? null;
            if ($raw === null) $raw = file_get_contents('php://input');

            if (!is_string($raw) || $raw === '') {
                $GLOBALS['requestBody'] = [];
                return;
            }

            // Project documents are large; this is the ceiling on ONE request
            // body, and it sits above the default 4 MB document cap so a legal
            // document is never refused by the wrong limit.
            if (strlen($raw) > 8 * 1024 * 1024) {
                jsonError('Request body too large (max 8MB)', 413);
            }

            $decoded = json_decode($raw, true);
            $GLOBALS['requestBody'] = is_array($decoded) ? $decoded : [];
        };
    }

    /**
     * Require X-Requested-With on mutating requests.
     *
     * A same-origin sentinel: a cross-site form post cannot set a custom
     * header without a CORS preflight, so the header's presence proves the
     * request came from code the browser considers same-origin.
     */
    public static function requireCsrf(): callable
    {
        return static function (array $params): void {
            $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
            if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) return;

            $xrw  = $_SERVER['HTTP_X_REQUESTED_WITH'] ?? '';
            $csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
            if ($xrw === '' && $csrf === '') {
                jsonError('Missing CSRF sentinel header', 403);
            }
        };
    }

    /**
     * Resolve the Bearer token. Populates currentUser()/currentSession().
     *
     * With $required, a missing or dead token ends the request as 401 — which
     * the client turns into "your session expired, sign in again" and drops the
     * token, rather than looping on it.
     */
    public static function auth(bool $required): callable
    {
        return static function (array $params) use ($required): void {
            $GLOBALS['currentUser'] = null;
            $GLOBALS['currentSession'] = null;

            $token = self::extractBearerToken();
            if ($token === null) {
                if ($required) jsonError('Authentication required', 401);
                return;
            }

            $session = Session::findByToken($token);
            if (!$session) {
                if ($required) jsonError('Invalid or expired session', 401);
                return;
            }

            $user = User::findById((int) $session['user_id']);
            if (!$user) {
                if ($required) jsonError('Session user not found', 401);
                return;
            }

            $GLOBALS['currentUser'] = $user;
            $GLOBALS['currentSession'] = $session;
        };
    }

    /**
     * Sliding-window rate limit, keyed by client IP + normalised path.
     *
     * File-based with flock(), because the deployment this is written for is a
     * shared host with no Redis and no cron.
     */
    public static function rateLimit(int $limit, int $window): callable
    {
        return static function (array $params) use ($limit, $window): void {
            if (!studioEnv('rate_limit.enabled', true)) return;

            $dir = (string) studioEnv('rate_limit.storage_path', STUDIO_SERVER_DIR . '/data/rate_limits');
            if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
                // Cannot record hits: fail OPEN. A rate limiter that takes the
                // whole API down when its scratch directory is missing is a
                // worse outage than the abuse it prevents.
                error_log('[studio] rate limit: cannot create ' . $dir);
                return;
            }

            /* Keyed on the matched ROUTE PATTERN, not on the path that matched
               it. A pattern with a parameter in it — `/studio/shared/:token`,
               `/studio/projects/:id` — gave every distinct parameter value its
               own bucket when keyed on the path. So the share-token endpoint,
               whose entire purpose is to resist guessing, offered 30 attempts
               PER TOKEN rather than 30 attempts, and each attempt minted a
               fresh JSON file in the rate-limit directory from an
               unauthenticated request: an unbounded write as well as an
               unbounded budget.
               Router::dispatch publishes the pattern. Falling back to the
               normalised path keeps this working for a middleware layer that
               runs before any route matched, and normalising the same way
               Router does keeps /auth/login, /auth/login/ and /auth//login on
               one bucket. */
            $rawPath  = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/';
            $normPath = '/' . trim(preg_replace('#/+#', '/', $rawPath), '/');
            $bucket   = (string) ($GLOBALS['_studio_route'] ?? $normPath);
            $key = sha1(self::clientIp() . '|' . $bucket);
            $file = $dir . '/' . substr($key, 0, 16) . '.json';

            $fp = @fopen($file, 'c+');
            if (!$fp) { error_log('[studio] rate limit: cannot open ' . $file); return; }

            try {
                if (!flock($fp, LOCK_EX)) return;

                $now = time();
                $cutoff = $now - $window;
                $raw = stream_get_contents($fp);
                $hits = $raw ? json_decode($raw, true) : [];
                if (!is_array($hits)) $hits = [];
                $hits = array_values(array_filter($hits, static fn($t) => is_int($t) && $t > $cutoff));

                if (count($hits) >= $limit) {
                    header('Retry-After: ' . max(1, $window - ($now - min($hits))));
                    jsonError('Rate limit exceeded', 429);
                }

                $hits[] = $now;
                ftruncate($fp, 0);
                rewind($fp);
                fwrite($fp, json_encode($hits));
            } finally {
                @flock($fp, LOCK_UN);
                @fclose($fp);
            }
        };
    }

    /** The Bearer token, from whichever place this SAPI left it. */
    public static function extractBearerToken(): ?string
    {
        $auth = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? '';

        // Several SAPIs (CGI/FastCGI without the rewrite) strip Authorization
        // from $_SERVER entirely; getallheaders() still has it.
        if ($auth === '' && function_exists('getallheaders')) {
            $headers = getallheaders();
            if (is_array($headers)) {
                $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';
            }
        }

        if (is_string($auth) && preg_match('/^Bearer\s+(.+)$/i', trim($auth), $m)) {
            return trim($m[1]);
        }
        return null;
    }

    /** Best-effort client IP, trusting X-Forwarded-For only when told to. */
    public static function clientIp(): string
    {
        if (studioEnv('app.trust_proxy', false) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            // The client controls everything it sends, so the LEFTMOST entry is
            // attacker-chosen and rotating it would defeat per-IP limiting. Skip
            // the configured number of proxy-appended entries from the right and
            // take the first hop we did not trust.
            $parts = array_values(array_filter(array_map('trim', explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']))));
            $hops = max(1, (int) studioEnv('app.trust_proxy_hops', 1));
            $index = max(0, count($parts) - $hops);
            $ip = $parts[$index] ?? '';
            if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
        }

        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
    }
}
