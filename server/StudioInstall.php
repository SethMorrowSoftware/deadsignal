<?php
/**
 * StudioInstall — the primitives the installer is built from.
 *
 * Kept separate from setup.php so that what the wizard *does* can be read,
 * reasoned about and tested without a browser: the env file format, the
 * migration runner, the capability-profile writer, the re-run guard and
 * account creation are all plain functions over plain values. `setup.php` is
 * then just a sequence of screens that calls them.
 *
 * Dependency-free on purpose — no bootstrap, no autoloader, no Database.php.
 * It runs before any of that exists.
 *
 * Paths are always derived from the studio folder passed in, never assumed, so
 * an install works from wherever the folder was copied to: a whole domain, a
 * subdirectory of an unrelated site, or a staging folder three levels down.
 */
final class StudioInstall
{
    // ---------------------------------------------------------------- layout

    /** The studio folder, given this file's location. */
    public static function studioDir(): string
    {
        return dirname(__DIR__);
    }

    public static function serverDir(): string { return __DIR__; }
    public static function envFile(): string { return __DIR__ . '/env.php'; }
    public static function profileFile(): string { return __DIR__ . '/config/studio.php'; }
    public static function lockFile(): string { return __DIR__ . '/config/.setup-complete'; }
    public static function migrationsDir(): string { return __DIR__ . '/migrations'; }

    /**
     * The API base the client should use, as a relative URL.
     *
     * Relative, always: the API ships inside the studio folder, so it moves
     * with it. An absolute path would break the moment the folder was copied
     * into a subdirectory, which is exactly the deployment this is for.
     */
    public static function relativeApiBase(): string
    {
        return './api';
    }

    /**
     * The API's absolute URL path, given the URL directory the wizard is
     * served from. Used for display and for the wizard's own reachability
     * check; the client resolves the relative form itself.
     */
    public static function apiUrlPath(string $studioUrlDir): string
    {
        $dir = rtrim(str_replace('\\', '/', $studioUrlDir), '/');
        return ($dir === '' ? '' : $dir) . '/api';
    }

    /**
     * The URL directory of the currently-executing script, from SCRIPT_NAME.
     *
     * SCRIPT_NAME rather than REQUEST_URI: the wizard posts to itself with a
     * query string, and REQUEST_URI carries it.
     */
    public static function scriptUrlDir(array $server): string
    {
        $script = (string) ($server['SCRIPT_NAME'] ?? $server['PHP_SELF'] ?? '/');
        $dir = str_replace('\\', '/', dirname($script));
        return $dir === '.' ? '/' : $dir;
    }

    // ------------------------------------------------------------------- env

    /**
     * server/env.php, in the schema the backend actually reads.
     *
     * Paths are emitted as __DIR__ expressions, never as resolved absolutes: a
     * baked-in path goes stale the moment a hosting account is moved or
     * renamed, and the failure then looks like a permissions bug.
     */
    public static function envTemplate(array $db, array $opts = []): string
    {
        $timezone = (string) ($opts['timezone'] ?? 'UTC');
        if (!in_array($timezone, DateTimeZone::listIdentifiers(), true)) $timezone = 'UTC';

        // A week, not a day: signing in again mid-edit is the kind of small
        // hostility that makes people stop using a tool.
        $lifetime = (int) ($opts['session_lifetime'] ?? 604800);
        $secret = (string) ($opts['setup_secret'] ?? bin2hex(random_bytes(20)));

        $v = static fn($x) => var_export($x, true);

        $out  = "<?php\n";
        $out .= "/**\n * Dead Signal Studio — backend configuration.\n";
        $out .= " * Written by setup.php on " . date('Y-m-d H:i:s') . ".\n *\n";
        $out .= " * Safe to edit by hand. Never commit it: it holds the database password.\n */\n";
        $out .= "return [\n";
        $out .= "    'app' => [\n";
        $out .= "        'name'             => 'Dead Signal Studio',\n";
        $out .= "        'debug'            => false,\n";
        $out .= "        'timezone'         => " . $v($timezone) . ",\n";
        $out .= "        // How long a sign-in lasts, in seconds.\n";
        $out .= "        'session_lifetime' => " . $lifetime . ",\n";
        $out .= "        // Only turn this on behind a proxy you control — otherwise a client\n";
        $out .= "        // can spoof X-Forwarded-For and walk past the rate limit.\n";
        $out .= "        'trust_proxy'      => false,\n";
        $out .= "        'trust_proxy_hops' => 1,\n";
        $out .= "    ],\n\n";
        $out .= "    'database' => [\n";
        $out .= "        'driver'   => 'mysql',\n";
        $out .= "        'host'     => " . $v((string) ($db['host'] ?? '127.0.0.1')) . ",\n";
        $out .= "        'port'     => " . (int) ($db['port'] ?? 3306) . ",\n";
        $out .= "        'database' => " . $v((string) ($db['database'] ?? '')) . ",\n";
        $out .= "        'username' => " . $v((string) ($db['username'] ?? '')) . ",\n";
        $out .= "        'password' => " . $v((string) ($db['password'] ?? '')) . ",\n";
        $out .= "        'charset'  => 'utf8mb4',\n";
        $out .= "    ],\n\n";
        $out .= "    'rate_limit' => [\n";
        $out .= "        'enabled'      => true,\n";
        $out .= "        'storage_path' => __DIR__ . '/data/rate_limits',\n";
        $out .= "    ],\n\n";
        $out .= "    // Proves server access when re-running setup.php on a configured install.\n";
        $out .= "    'setup' => [\n";
        $out .= "        'secret' => " . $v($secret) . ",\n";
        $out .= "    ],\n";
        $out .= "];\n";

        return $out;
    }

    /**
     * Is this a database name we are willing to put in a `CREATE DATABASE`?
     *
     * An identifier cannot be a bound parameter, so it is escaped by doubling
     * backticks — and checked against this allowlist first, because "escaped
     * correctly" is a claim that should not be the only thing standing between
     * a form field and a DDL statement. MySQL's own rules are wider than this;
     * no real database name needs the difference.
     */
    public static function isSafeDatabaseName(string $name): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9_$][A-Za-z0-9_$-]{0,62}$/', $name);
    }

    /** An identifier, quoted for interpolation. Only for names isSafeDatabaseName() accepted. */
    public static function quoteIdentifier(string $name): string
    {
        return '`' . str_replace('`', '``', $name) . '`';
    }

    /**
     * Select a database, creating it if it is not there.
     *
     * $pdo must be connected to the SERVER (no dbname in the DSN). Creating is
     * the friendly default because on a VPS, a local machine, or any host whose
     * MySQL user holds CREATE, the alternative is telling someone to go and
     * make an empty database by hand before the installer will talk to them.
     * Where the user does not hold CREATE — cPanel, mostly — this fails and the
     * caller says so, which is the same place we were before.
     *
     * @return bool true when the database had to be created
     * @throws RuntimeException with a message worth showing a person
     */
    public static function useOrCreateDatabase(PDO $pdo, string $name): bool
    {
        if (!self::isSafeDatabaseName($name)) {
            throw new \RuntimeException('That database name has characters this installer will not put in a query. Use letters, numbers, underscores and hyphens.');
        }
        $quoted = self::quoteIdentifier($name);

        try {
            $pdo->exec('USE ' . $quoted);
            return false;
        } catch (PDOException $e) {
            $code = (int) ($e->errorInfo[1] ?? 0);
            // 1049 is "unknown database". 1044 is "access denied to this
            // database" — which MySQL ALSO returns for a database that does not
            // exist when the user holds no privilege on it, deliberately, so as
            // not to confirm what does and does not exist. That is the shape a
            // cPanel account has, so both are worth trying to create.
            // Anything else (server gone away, bad credentials) is not ours to
            // fix by creating something.
            if ($code !== 1049 && $code !== 1044) throw $e;
            $denied = $code === 1044;
        }

        try {
            $pdo->exec('CREATE DATABASE ' . $quoted . ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
            $pdo->exec('USE ' . $quoted);
            return true;
        } catch (PDOException $e) {
            $safe = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
            throw new \RuntimeException($denied
                // Two causes, indistinguishable from here because MySQL will not
                // say which — so name both, and the one action that fixes either.
                ? 'MySQL will not let this user reach a database called <strong>' . $safe . '</strong>: '
                  . 'either it does not exist and the user may not create one, or it exists and this '
                  . 'user was never added to it. On cPanel: MySQL Databases → Create New Database, '
                  . 'then Add User To Database with All Privileges.'
                : 'The database <strong>' . $safe . '</strong> does not exist, and this MySQL user is '
                  . 'not allowed to create it. Create it first — on cPanel that is MySQL Databases → '
                  . 'Create New Database, then Add User To Database with All Privileges.');
        }
    }

    /** The database section of an env array, canonical key first, legacy fallback. */
    public static function dbConfig(array $env): array
    {
        $db = $env['database'] ?? $env['db'] ?? [];
        return is_array($db) ? $db : [];
    }

    /**
     * Connect to the SERVER rather than to a database.
     *
     * What both installers need before the database is known to exist — and
     * what makes creating it possible at all.
     */
    public static function connectServer(array $db): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;charset=%s',
            (string) ($db['host'] ?? '127.0.0.1'),
            (int) ($db['port'] ?? 3306),
            (string) ($db['charset'] ?? 'utf8mb4')
        );
        return new PDO($dsn, (string) ($db['username'] ?? $db['user'] ?? ''), (string) ($db['password'] ?? $db['pass'] ?? ''), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 10,
        ]);
    }

    /** Open a connection from an env array. Throws PDOException like any other connect. */
    public static function connect(array $db): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            (string) ($db['host'] ?? '127.0.0.1'),
            (int) ($db['port'] ?? 3306),
            (string) ($db['database'] ?? $db['name'] ?? ''),
            (string) ($db['charset'] ?? 'utf8mb4')
        );
        return new PDO($dsn, (string) ($db['username'] ?? $db['user'] ?? ''), (string) ($db['password'] ?? $db['pass'] ?? ''), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 10,
        ]);
    }

    /**
     * The secret a re-run of the wizard must prove knowledge of.
     *
     * Anyone who can read env.php is already on the server; anyone who cannot
     * has no business re-pointing the install at their own database. The DB
     * password first, then the generated setup secret for installs where the
     * password is empty (socket auth, some managed hosts) — otherwise the guard
     * would not bite there at all.
     */
    public static function reconfirmSecret(array $env): string
    {
        foreach ([
            $env['database']['password'] ?? null,
            $env['db']['password'] ?? null,
            $env['setup']['secret'] ?? null,
        ] as $candidate) {
            if (is_string($candidate) && $candidate !== '') return $candidate;
        }
        return '';
    }

    /**
     * Must this request prove server access before the wizard will run?
     *
     * Getting this wrong is invisible in one direction and fatal in the other.
     * The wizard writes env.php at step 2 and locks the install at step 5,
     * which means a naive "an env file exists, so demand the key" check locks
     * out the very session doing the installing — a fresh browser install
     * cannot get past migrations. The exemption is therefore scoped to the run
     * that created the configuration, and it ends the instant the install locks
     * itself.
     *
     * @param bool   $envExists    server/env.php is present
     * @param bool   $isLocked     server/config/.setup-complete is present
     * @param bool   $creatingHere this session created the configuration
     * @param string $secret       what the key is checked against ('' = nothing to prove)
     */
    public static function needsReconfirm(bool $envExists, bool $isLocked, bool $creatingHere, string $secret): bool
    {
        if (!$envExists) return false;      // nothing configured yet — first run
        if ($isLocked) return true;         // finished installs: always, this session included
        if ($secret === '') return false;   // mid-install, nothing to check against
        return !$creatingHere;
    }

    /**
     * A finished install with no secret at all: the wizard must not run, and no
     * key can unlock it either.
     *
     * `$secret === ''` used to be checked BEFORE the lock, so the guard failed
     * OPEN in exactly that case — an anonymous visitor got the whole installer
     * on a live install, could re-point it at a database of their own and
     * create themselves an account at step 5. Reachable without anything
     * exotic: server/env.example.php ships with an empty database password AND
     * an empty setup.secret, and copying it by hand is a documented way to
     * configure the studio, so any socket-auth install set up that way had an
     * open installer.
     *
     * Refusing outright rather than demanding a key that does not exist is the
     * point: there is nothing to compare against, so any check would either
     * pass for everyone or fail for everyone. The way back in is from the
     * server — write a `setup.secret` into env.php, or delete the lock file —
     * which is exactly the access this guard exists to require.
     */
    public static function lockedWithNoSecret(bool $envExists, bool $isLocked, string $secret): bool
    {
        return $envExists && $isLocked && $secret === '';
    }

    /** Constant-time check of a supplied reconfirm key. */
    public static function keyAccepted(string $secret, $given): bool
    {
        return $secret !== '' && is_string($given) && hash_equals($secret, $given);
    }

    // ------------------------------------------------------------ migrations

    /**
     * "Already there" rather than "broken": duplicate table (1050), duplicate
     * column (1060), duplicate key (1061). Re-running over an existing schema is
     * a normal thing to do — and the studio's own schema is deliberately
     * CREATE TABLE IF NOT EXISTS so it can be installed alongside an
     * application that already owns a `users` table.
     */
    public static function isIgnorableMigrationError(PDOException $e): bool
    {
        $sqlState   = (string) ($e->errorInfo[0] ?? '');
        $driverCode = (int) ($e->errorInfo[1] ?? 0);

        return in_array($driverCode, [1050, 1060, 1061], true)
            || in_array($sqlState, ['42S01', '42S21'], true);
    }

    /**
     * Apply every pending migration, in filename order.
     *
     * The bookkeeping table is named `_studio_migrations` rather than
     * `_migrations`: the studio may be sharing a database with something else
     * that keeps its own ledger under the obvious name, and two applications
     * writing one ledger is how a migration silently gets skipped.
     *
     * @return array{results: list<array{file:string,status:string,msg:string}>, errors: list<string>, applied: int}
     */
    public static function migrate(PDO $pdo, ?string $migrationsDir = null): array
    {
        $migrationsDir = $migrationsDir ?? self::migrationsDir();
        $results = [];
        $errors  = [];
        $applied = 0;

        $pdo->exec('
            CREATE TABLE IF NOT EXISTS _studio_migrations (
                id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                filename    VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ');

        $executed = $pdo->query('SELECT filename FROM _studio_migrations')->fetchAll(PDO::FETCH_COLUMN);

        $files = glob(rtrim($migrationsDir, '/') . '/*.sql') ?: [];
        sort($files);
        if (!$files) {
            return ['results' => [], 'errors' => ['No migration files found in ' . $migrationsDir], 'applied' => 0];
        }

        foreach ($files as $file) {
            $filename = basename($file);

            if (in_array($filename, $executed, true)) {
                $results[] = ['file' => $filename, 'status' => 'skip', 'msg' => 'Already applied'];
                continue;
            }

            $sql = (string) file_get_contents($file);
            if (trim($sql) === '') {
                $results[] = ['file' => $filename, 'status' => 'skip', 'msg' => 'Empty file'];
                continue;
            }

            try {
                // No transaction: MySQL commits implicitly on DDL, so wrapping
                // these would end the transaction mid-file and then fail with
                // "no active transaction" on the next statement.
                $pdo->exec($sql);
                $pdo->prepare('INSERT INTO _studio_migrations (filename) VALUES (?)')->execute([$filename]);
                $results[] = ['file' => $filename, 'status' => 'ok', 'msg' => 'Applied'];
                $applied++;
            } catch (PDOException $e) {
                if (self::isIgnorableMigrationError($e)) {
                    $pdo->prepare('INSERT INTO _studio_migrations (filename) VALUES (?)')->execute([$filename]);
                    $results[] = ['file' => $filename, 'status' => 'ok', 'msg' => 'Schema already present'];
                    continue;
                }

                $msg = $e->getMessage();
                // A syntax error at a JSON column is not a broken migration —
                // it is a server too old to know the type. Say which.
                if ((int) ($e->errorInfo[1] ?? 0) === 1064 && stripos($msg, 'json') !== false) {
                    $msg .= ' — this usually means the database server is too old for JSON columns.'
                          . ' MySQL 5.7.8+ or MariaDB 10.2.7+ is required; ask your host to move the database to a newer server.';
                }
                $results[] = ['file' => $filename, 'status' => 'fail', 'msg' => $msg];
                $errors[]  = 'Migration ' . $filename . ' failed: ' . $msg;
                break;   // stop on first real failure
            }
        }

        return ['results' => $results, 'errors' => $errors, 'applied' => $applied];
    }

    // --------------------------------------------------------------- profile

    /** server/config/studio.php, as text. */
    public static function studioProfileFile(array $profile): string
    {
        $out  = "<?php\n";
        $out .= "/**\n * Dead Signal Studio — capability profile.\n";
        $out .= " * Written by setup.php on " . date('Y-m-d H:i:s') . ".\n *\n";
        $out .= " * Safe to edit by hand, and safe to delete and regenerate: every value here\n";
        $out .= " * is re-derivable from the host. `enabled => false` turns the backend off\n";
        $out .= " * without uninstalling anything — the studio then runs browser-only.\n */\n";

        $lines = [];
        foreach ($profile as $k => $v) {
            // storage_path stays a __DIR__ expression for the same reason the
            // env paths do: an absolute path dies when the account moves, and
            // then every upload fails with a message about directories.
            $lines[] = $k === 'storage_path'
                ? "    'storage_path' => __DIR__ . '/../data/studio',"
                : '    ' . var_export($k, true) . ' => ' . var_export($v, true) . ',';
        }
        $out .= "return [\n" . implode("\n", $lines) . "\n];\n";
        return $out;
    }

    /** Write server/config/studio.php. Returns null on success, else the error. */
    public static function writeStudioProfile(array $profile, ?string $file = null): ?string
    {
        $file = $file ?? self::profileFile();
        $dir = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            return 'Could not create <code>server/config/</code> — create it and make it writable (755).';
        }
        if (@file_put_contents($file, self::studioProfileFile($profile), LOCK_EX) === false) {
            return 'Failed to write <code>server/config/studio.php</code>. Check that <code>server/config/</code> is writable (755).';
        }
        @chmod($file, 0640);
        return null;
    }

    /**
     * The deployment note the client reads before guessing.
     *
     * Written beside index.html, holding the API base as a *relative* URL. It
     * saves the client a probe, and it is the only way to point the studio at
     * an API on another host without typing the address on the CLOUD tab. It is
     * optional everywhere: the client falls back to probing, and a deployment
     * whose studio folder is read-only (a sensible thing to want) is
     * unaffected.
     */
    public static function writeDeployConfig(string $studioDir, string $apiBase): ?string
    {
        $file = rtrim($studioDir, '/') . '/studio.config.json';
        $json = json_encode([
            'apiBase'   => $apiBase,
            'generated' => date('c'),
            'note'      => 'Written by the studio setup wizard. Relative to this folder. Delete to let the studio auto-detect.',
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";

        if (@file_put_contents($file, $json, LOCK_EX) === false) {
            return 'Could not write studio.config.json (the folder is not writable) — harmless: the studio finds the API by probing, and the CLOUD tab can be told directly.';
        }
        return null;
    }

    /** Deny direct web access to a directory, if it is not already denied. */
    public static function writeDenyFile(string $dir, string $why): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) return;
        $ht = rtrim($dir, '/') . '/.htaccess';
        if (is_file($ht)) return;
        @file_put_contents($ht, "# $why\n# Files here are served only through the API, never directly.\nRequire all denied\n"
            . "<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n", LOCK_EX);
    }

    // -------------------------------------------------------------- accounts

    public static function uuid(): string
    {
        $data = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }

    /** Does this install have any account at all? */
    public static function anyUserExists(PDO $pdo): bool
    {
        try {
            return (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0;
        } catch (PDOException $e) {
            return false;   // no users table yet == no users
        }
    }

    public static function displayNameTaken(PDO $pdo, string $displayName): bool
    {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE display_name = ?');
        $stmt->execute([$displayName]);
        return (int) $stmt->fetchColumn() > 0;
    }

    /**
     * Create an account.
     *
     * bcrypt at cost 12 — the same cost the backend verifies against, so a
     * password set here behaves identically to one set anywhere else.
     *
     * @return int the account id
     */
    public static function createAccount(PDO $pdo, string $displayName, string $password, string $role = 'user'): int
    {
        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $stmt = $pdo->prepare(
            'INSERT INTO users (uuid, display_name, password_hash, role, is_anonymous, created_at)
             VALUES (?, ?, ?, ?, 0, NOW())'
        );
        $stmt->execute([self::uuid(), $displayName, $hash, $role]);
        return (int) $pdo->lastInsertId();
    }

    /** Reset an existing account's password. Returns false when there is no such account. */
    public static function resetPassword(PDO $pdo, string $displayName, string $password): bool
    {
        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $stmt = $pdo->prepare('UPDATE users SET password_hash = ? WHERE display_name = ?');
        $stmt->execute([$hash, $displayName]);
        return $stmt->rowCount() > 0;
    }
}
