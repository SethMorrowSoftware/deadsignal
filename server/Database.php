<?php
/**
 * Database — PDO singleton with prepared-statement helpers.
 *
 * Every query in this backend goes through one of these methods with bound
 * parameters. There is no method that takes interpolated SQL, deliberately:
 * the absence is the guarantee.
 *
 *   $row  = Database::fetchOne('SELECT * FROM users WHERE id = ?', [$id]);
 *   $rows = Database::fetchAll('SELECT * FROM studio_assets WHERE owner_id = ?', [$uid]);
 *   $id   = Database::insert('INSERT INTO studio_projects (...) VALUES (?, ?)', [...]);
 *   Database::execute('DELETE FROM studio_shares WHERE id = ?', [$id]);
 */
class Database
{
    private static ?PDO $instance = null;

    public static function getInstance(): PDO
    {
        if (self::$instance === null) self::connect();
        return self::$instance;
    }

    /** Inject a connection — used by the installer and the test suites. */
    public static function setInstance(?PDO $pdo): void
    {
        self::$instance = $pdo;
    }

    private static function connect(): void
    {
        $cfg = studioEnv('database', []);
        if (!is_array($cfg)) $cfg = [];

        $driver = $cfg['driver'] ?? 'mysql';
        if ($driver !== 'mysql') {
            throw new \RuntimeException("Unsupported database driver: $driver");
        }

        $charset = (string) ($cfg['charset'] ?? 'utf8mb4');
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            (string) ($cfg['host'] ?? '127.0.0.1'),
            (int) ($cfg['port'] ?? 3306),
            (string) ($cfg['database'] ?? ''),
            $charset
        );

        try {
            self::$instance = new PDO($dsn, (string) ($cfg['username'] ?? ''), (string) ($cfg['password'] ?? ''), [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES $charset",
            ]);
        } catch (\PDOException $e) {
            // The message can carry the DSN, which carries the database name and
            // host. That belongs in the log, not in a response.
            error_log('[studio] Database connection failed: ' . $e->getMessage());
            throw new \RuntimeException('Database connection failed', (int) $e->getCode());
        }
    }

    public static function fetchOne(string $sql, array $params = []): ?array
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public static function fetchAll(string $sql, array $params = []): array
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public static function fetchColumn(string $sql, array $params = [])
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        $val = $stmt->fetchColumn();
        return $val === false ? null : $val;
    }

    public static function insert(string $sql, array $params = []): int
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        return (int) self::getInstance()->lastInsertId();
    }

    public static function execute(string $sql, array $params = []): int
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }

    /** Commit on success, roll back on throw. Nested calls just run inline. */
    public static function transaction(callable $callback)
    {
        $pdo = self::getInstance();
        if ($pdo->inTransaction()) return $callback();

        $pdo->beginTransaction();
        try {
            $result = $callback();
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }
}
