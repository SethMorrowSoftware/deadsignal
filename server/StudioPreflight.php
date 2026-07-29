<?php
/**
 * Dead Signal Studio — host capability preflight.
 *
 * One implementation of "what can this host actually do", used by the setup
 * wizard (setup.php, step 1) and by the standalone preflight.php page. Two
 * copies of these thresholds would drift, and the answer they give decides
 * what the client is allowed to offer.
 *
 * Deliberately dependency-free: no bootstrap, no Database.php, no autoloader.
 * The standalone page runs before anything is installed, and the wizard
 * explicitly avoids loading the backend while configuring it.
 *
 * Every path is derived from the studio folder passed in — the folder holding
 * index.html — so this is correct wherever that folder has been copied to.
 *
 * Nothing here writes anything except one temp probe file, which it removes.
 * (It may also issue one read-only HTTP GET against this same install, to
 * verify the web server actually enforces server/data/.htaccess.)
 */

final class StudioPreflight
{
    public const OK = 'ok';
    public const WARN = 'warn';
    public const BLOCK = 'block';

    /** Bytes from a php.ini shorthand size ("32M", "1G", "-1" for unlimited). */
    public static function iniBytes(string $key): int
    {
        $raw = trim((string) ini_get($key));
        if ($raw === '') return 0;
        if ($raw === '-1') return -1;
        $unit = strtolower(substr($raw, -1));
        $n = (float) $raw;
        switch ($unit) {
            case 'g': $n *= 1024; // fall through
            case 'm': $n *= 1024; // fall through
            case 'k': $n *= 1024;
        }
        return (int) $n;
    }

    public static function human(int $b): string
    {
        if ($b < 0) return 'unlimited';
        $u = ['B', 'KB', 'MB', 'GB', 'TB'];
        $i = 0;
        $n = (float) $b;
        while ($n >= 1024 && $i < count($u) - 1) { $n /= 1024; $i++; }
        return ($i === 0 ? (int) $n : round($n, 1)) . ' ' . $u[$i];
    }

    /** Callable, or has the host disabled it? function_exists() alone is not enough. */
    public static function fnEnabled(string $name): bool
    {
        if (!function_exists($name)) return false;
        $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
        return !in_array($name, $disabled, true);
    }

    /** Absolute path to ffmpeg, or null. */
    public static function findFfmpeg(): ?string
    {
        if (!self::fnEnabled('exec')) return null;
        $out = [];
        $code = 1;
        @exec('command -v ffmpeg 2>/dev/null', $out, $code);
        return ($code === 0 && !empty($out[0])) ? trim((string) $out[0]) : null;
    }

    /**
     * The upload chunk size this host can actually accept.
     *
     * Uploads are chunked precisely so a small limit means more requests rather
     * than a failed upload. 80% of the limit leaves room for the multipart
     * envelope — so the floor must sit BELOW any plausible host limit: a floor
     * above it would advertise a chunk the host rejects, and PHP discards the
     * whole POST when post_max_size is exceeded, failing every upload. 64 KB
     * matches StudioStorage::chunkSize()'s own clamp; a host tighter than that
     * is flagged as blocking by the limits check instead.
     */
    public static function chunkSize(): int
    {
        $post = self::iniBytes('post_max_size');
        $upload = self::iniBytes('upload_max_filesize');
        $effective = min($post > 0 ? $post : PHP_INT_MAX, $upload > 0 ? $upload : PHP_INT_MAX);
        if ($effective === PHP_INT_MAX) return 2 * 1024 * 1024;
        return max(64 * 1024, min(2 * 1024 * 1024, (int) ($effective * 0.8)));
    }

    /**
     * Ask the web server itself whether server/data/.htaccess is fetchable.
     *
     * Returns the HTTP status (200 = the storage tree is exposed), or null when
     * the check cannot run: from the CLI, under PHP's single-threaded built-in
     * server (a request to ourselves would deadlock it), or when the request
     * fails.
     */
    public static function probeDataProtection(string $studioDir): ?int
    {
        $base = self::webBaseFor($studioDir);
        if ($base === null) return null;
        $ctx = stream_context_create(['http' => [
            'method' => 'GET', 'timeout' => 3, 'ignore_errors' => true,
        ]]);
        @file_get_contents($base . '/server/data/.htaccess', false, $ctx);
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $h, $m)) return (int) $m[1];
        }
        return null;
    }

    /** The studio folder's own base URL, derivable only when serving a real request. */
    private static function webBaseFor(string $root): ?string
    {
        if (in_array(php_sapi_name(), ['cli', 'cli-server'], true)) return null;
        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        if ($host === '' || !preg_match('/^[A-Za-z0-9.\-\[\]:]+$/', $host)) return null;
        $scriptFs = realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? ''));
        $rootFs = realpath($root);
        $scriptUrl = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
        if (!$scriptFs || !$rootFs || strpos($scriptFs, $rootFs . DIRECTORY_SEPARATOR) !== 0) return null;
        // Map the script's path inside $root onto its URL to find where the
        // studio folder is mounted (this file is used from setup.php AND from
        // preflight.php, which sit at different depths in some installs).
        $rel = str_replace(DIRECTORY_SEPARATOR, '/', substr($scriptFs, strlen($rootFs)));
        if ($rel === '' || substr($scriptUrl, -strlen($rel)) !== $rel) return null;
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        return $scheme . '://' . $host . substr($scriptUrl, 0, strlen($scriptUrl) - strlen($rel));
    }

    /**
     * Does this database server support JSON columns?
     *
     * Factored out so setup.php can run it at step 2 — with credentials just
     * proven — BEFORE step 3 runs migrations: 001_users.sql contains a JSON
     * column, so on an old server the raw SQL error landed before the friendly
     * host report ever got the chance to explain it.
     *
     * @return array{ok:bool, version:string}
     */
    public static function jsonColumnSupport(PDO $pdo): array
    {
        $ver = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
        $isMaria = stripos($ver, 'mariadb') !== false;
        preg_match('/(\d+)\.(\d+)\.(\d+)/', $ver, $m);
        $num = $m ? "$m[1].$m[2].$m[3]" : '0.0.0';
        $ok = $isMaria
            ? version_compare($num, '10.2.7', '>=')
            : version_compare($num, '5.7.8', '>=');
        return ['ok' => $ok, 'version' => $ver];
    }

    /** Prove a directory is writable rather than trusting is_writable(). */
    public static function reallyWritable(string $dir): bool
    {
        // is_writable() can disagree with reality under some suEXEC and ACL
        // setups, and finding that out at first upload is far too late.
        if (!is_dir($dir) || !is_writable($dir)) return false;
        $probe = rtrim($dir, '/') . '/.studio-write-probe';
        $ok = @file_put_contents($probe, 'x') !== false;
        @unlink($probe);
        return $ok;
    }

    private static function row(string $status, string $name, string $detail, string $consequence = ''): array
    {
        return compact('status', 'name', 'detail', 'consequence');
    }

    /**
     * Every check, as rows of {status, name, detail, consequence}.
     *
     * @param string   $studioDir the studio folder (the one holding index.html)
     * @param PDO|null $pdo       an open connection, when one is available
     */
    public static function checks(string $studioDir, ?PDO $pdo = null): array
    {
        $r = [];

        /* ---- PHP ---- */
        $phpOk = version_compare(PHP_VERSION, '8.0', '>=');
        $r[] = self::row($phpOk ? self::OK : self::BLOCK, 'PHP version', PHP_VERSION,
            $phpOk ? '' : 'Needs PHP 8.0 or newer. Change it in cPanel → MultiPHP Manager.');

        $exts = [
            'pdo_mysql' => [self::BLOCK, 'No database access at all — this is the one that stops everything.'],
            'json'      => [self::BLOCK, 'Project documents are JSON. Nothing works without it.'],
            'mbstring'  => [self::BLOCK, 'Needed for safe handling of author-supplied text.'],
            'fileinfo'  => [self::BLOCK, 'Upload types are detected server-side. Without it uploads cannot be trusted, so they are refused.'],
            'zip'       => [self::WARN,  'Multi-file pack import is unavailable. Single-file import and every shipped pack still work.'],
            'gd'        => [self::WARN,  'Thumbnails are generated in the browser instead of on the server.'],
            'openssl'   => [self::WARN,  'Share-link tokens fall back to a weaker random source. Named-account sharing is unaffected.'],
        ];
        foreach ($exts as $ext => $info) {
            $have = extension_loaded($ext);
            $r[] = self::row($have ? self::OK : $info[0], "Extension: $ext",
                $have ? 'loaded' : 'missing', $have ? '' : $info[1]);
        }

        /* ---- limits ---- */
        $post = self::iniBytes('post_max_size');
        $upload = self::iniBytes('upload_max_filesize');
        $chunk = self::chunkSize();
        $effective = min($post > 0 ? $post : PHP_INT_MAX, $upload > 0 ? $upload : PHP_INT_MAX);
        // Below ~128 KB even the smallest chunk plus its multipart envelope
        // risks exceeding post_max_size, and PHP discards the whole POST — so
        // the reassuring "more requests, never a failure" line stops being true
        // and this becomes a blocker rather than a warning.
        $limitStatus = $effective >= 2 * 1024 * 1024 ? self::OK
            : ($effective < 128 * 1024 ? self::BLOCK : self::WARN);
        $r[] = self::row($limitStatus, 'Upload limits',
            'post_max_size ' . self::human($post) . ' · upload_max_filesize ' . self::human($upload)
                . ' → chunk size ' . self::human($chunk),
            $limitStatus === self::OK ? ''
                : ($limitStatus === self::BLOCK
                    ? 'Too small even for chunked uploads — raise post_max_size and upload_max_filesize to at least 1M in cPanel → MultiPHP INI Editor.'
                    : 'Small, but workable: uploads are chunked, so this means more requests per file rather than a failure.'));

        $mem = self::iniBytes('memory_limit');
        $memOk = $mem < 0 || $mem >= 128 * 1024 * 1024;
        $r[] = self::row($memOk ? self::OK : self::WARN, 'memory_limit', self::human($mem),
            $memOk ? '' : 'Tight. Server-side rendering would be disabled; browser rendering is unaffected.');

        $exec = (int) ini_get('max_execution_time');
        $execOk = $exec === 0 || $exec >= 30;
        $r[] = self::row($execOk ? self::OK : self::WARN, 'max_execution_time',
            $exec === 0 ? 'unlimited' : $exec . 's',
            $execOk ? '' : 'Short. Long server tasks would be split into smaller units.');

        /* ---- storage ---- */
        // Probe the deepest EXISTING directory rather than creating
        // server/data/studio as a side effect — this class promises to write
        // nothing but the temp probe file. StudioStorage creates the tree on
        // first use.
        $serverDir = rtrim($studioDir, '/') . '/server';
        $dataDir = $serverDir . '/data';
        $assetDir = $dataDir . '/studio';
        $target = is_dir($assetDir) ? $assetDir : (is_dir($dataDir) ? $dataDir : (is_dir($serverDir) ? $serverDir : $studioDir));
        $writable = self::reallyWritable($target);
        $r[] = self::row($writable ? self::OK : self::BLOCK, 'Asset storage writable', $target,
            $writable ? '' : 'Assets cannot be stored. chmod 755 the directory (775 if PHP runs as a different user).');

        $ht = $dataDir . '/.htaccess';
        $hasDeny = is_file($ht)
            && preg_match('/Deny from all|Require all denied/i', (string) @file_get_contents($ht));
        // The file's bytes only prove intent — AllowOverride None ignores them
        // silently. When running over HTTP, fetch the file through the web
        // server and let what it actually answers decide.
        $probe = self::probeDataProtection($studioDir);
        if ($probe === 200) {
            $r[] = self::row(self::BLOCK, 'server/data/ protected by .htaccess',
                'NOT enforced — server/data/.htaccess is web-readable (live-checked)',
                'The web server serves server/data/ directly, so uploaded assets can be fetched by URL. This host likely ignores .htaccess (AllowOverride None) — point storage_path in server/config/studio.php at a directory above the docroot, or deny it in the server config.');
        } elseif ($probe !== null && $hasDeny) {
            $r[] = self::row(self::OK, 'server/data/ protected by .htaccess',
                'present and enforced (live-checked: HTTP ' . $probe . ')', '');
        } else {
            $r[] = self::row($hasDeny ? self::OK : self::WARN, 'server/data/ protected by .htaccess',
                $hasDeny ? 'present (file check only)' : 'missing or permissive',
                $hasDeny
                    ? 'Could not live-verify enforcement. Confirm by opening server/data/.htaccess in a browser — some hosts ignore .htaccess. If it downloads, move the storage directory above the docroot.'
                    : 'Uploaded assets could be fetched directly by URL. Add the deny rule, or point storage_path above the docroot.');
        }

        // api/.htaccess is load-bearing, not hardening: without it every API
        // request 404s on Apache — the single most common deploy failure,
        // because many FTP clients skip dotfiles.
        $apiHt = rtrim($studioDir, '/') . '/api/.htaccess';
        $r[] = self::row(is_file($apiHt) ? self::OK : self::WARN, 'api/.htaccess present',
            is_file($apiHt) ? 'present' : 'missing',
            is_file($apiHt) ? ''
                : 'On Apache every API call will 404 and the backend looks down. Re-upload api/.htaccess — many FTP clients skip dotfiles.');

        $free = @disk_free_space($studioDir);
        $freeOk = $free !== false && $free > 1024 * 1024 * 1024;
        $r[] = self::row($freeOk ? self::OK : self::WARN, 'Free disk space',
            $free === false ? 'unknown' : self::human((int) $free),
            $freeOk ? '' : 'Video assets are large. Set a conservative per-user quota.');

        /* ---- optional server rendering ---- */
        $canExec = self::fnEnabled('exec') || self::fnEnabled('proc_open');
        $r[] = self::row($canExec ? self::OK : self::WARN, 'exec() / proc_open()',
            $canExec ? 'enabled' : 'disabled by the host',
            $canExec ? '' : 'Server-side rendering is off. Common on shared hosting and costs little — browser rendering is the default engine.');

        $ffmpeg = self::findFfmpeg();
        $r[] = self::row($ffmpeg ? self::OK : self::WARN, 'ffmpeg', $ffmpeg ?: 'not found',
            $ffmpeg ? '' : 'Optional. Renders run in the browser instead; large exports simply take longer.');

        /* ---- database ---- */
        if ($pdo instanceof PDO) {
            try {
                /* The schema stores project documents in a JSON column. This
                   is the single most common blocker on an older shared host —
                   which is why setup.php also runs jsonColumnSupport() at step
                   2, before any migration can fail on it with a raw SQL
                   error. */
                $json = self::jsonColumnSupport($pdo);
                $ver = $json['version'];
                $jsonOk = $json['ok'];
                $r[] = self::row($jsonOk ? self::OK : self::BLOCK, 'JSON column support', $ver,
                    $jsonOk ? '' : 'Project documents need a JSON column: MySQL 5.7.8+ or MariaDB 10.2.7+. Ask your host to move the database to a newer server.');

                $innodb = false;
                foreach ($pdo->query('SHOW ENGINES')->fetchAll(PDO::FETCH_ASSOC) as $e) {
                    if (strcasecmp((string) ($e['Engine'] ?? ''), 'InnoDB') === 0
                        && in_array(strtoupper((string) ($e['Support'] ?? '')), ['YES', 'DEFAULT'], true)) {
                        $innodb = true;
                    }
                }
                $r[] = self::row($innodb ? self::OK : self::BLOCK, 'InnoDB',
                    $innodb ? 'available' : 'unavailable',
                    $innodb ? '' : 'The schema uses foreign keys with cascade, which MyISAM does not support.');

                $charset = (string) $pdo->query('SELECT @@character_set_database')->fetchColumn();
                $csOk = stripos($charset, 'utf8mb4') === 0;
                $r[] = self::row($csOk ? self::OK : self::WARN, 'Database charset', $charset,
                    $csOk ? '' : 'Should be utf8mb4, or four-byte characters (emoji, some symbols) are mangled.');

                $packet = (int) $pdo->query('SELECT @@max_allowed_packet')->fetchColumn();
                $pkOk = $packet >= 4 * 1024 * 1024;
                $r[] = self::row($pkOk ? self::OK : self::WARN, 'max_allowed_packet', self::human($packet),
                    $pkOk ? '' : 'A large project document could exceed this. The document cap would need lowering to match.');
            } catch (Throwable $e) {
                $r[] = self::row(self::WARN, 'Database checks', 'could not run',
                    'The connection worked but the server refused these queries (' . get_class($e) . ').');
            }
        } else {
            $r[] = self::row(self::WARN, 'Database', 'not connected',
                'Create one in cPanel → MySQL Databases and run setup.php. Re-run this check afterwards to verify the server version.');
        }

        return $r;
    }

    /** Tally rows by status. */
    public static function tally(array $rows): array
    {
        $c = [self::OK => 0, self::WARN => 0, self::BLOCK => 0];
        foreach ($rows as $row) {
            if (isset($c[$row['status']])) $c[$row['status']]++;
        }
        return $c;
    }

    /**
     * The capability profile the client reads at bootstrap.
     *
     * Derived from the same values the checks report, so the report and the
     * behaviour cannot disagree. No feature is ever present-but-broken: what
     * the host cannot do is simply not offered.
     */
    public static function profile(string $studioDir, array $overrides = []): array
    {
        $ffmpeg = self::findFfmpeg();
        $serverRender = $ffmpeg !== null && (self::fnEnabled('exec') || self::fnEnabled('proc_open'));

        $profile = [
            'enabled'           => true,
            'storage_path'      => rtrim($studioDir, '/') . '/server/data/studio',
            'user_quota'        => 2147483648,   // 2 GB
            'max_asset_size'    => 536870912,    // 512 MB
            'max_document_size' => 4194304,      // 4 MB
            'chunk_size'        => self::chunkSize(),
            'server_render'     => $serverRender,
            'ffmpeg_path'       => $ffmpeg,
            'cron_enabled'      => false,
            'packs_enabled'     => extension_loaded('zip'),
            'collab'            => 'comments',
        ];

        foreach ($overrides as $k => $v) {
            // Only known keys, so a stray form field cannot invent config.
            if (array_key_exists($k, $profile)) $profile[$k] = $v;
        }
        return $profile;
    }
}
