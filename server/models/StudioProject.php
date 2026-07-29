<?php
/**
 * StudioProject - A Media Studio project stored server-side.
 *
 * The `document` column holds the studio's project document verbatim: the same
 * JSON the standalone tool saves to disk. That is deliberate — the studio stays
 * the authority on its own format, and the backend stores and shares it without
 * needing to understand it. Binaries never live here; they are rows in
 * studio_assets and files on disk.
 *
 * Access is decided by StudioShare, not by this model. Every read here takes an
 * explicit owner or project id that the controller has already authorised.
 */
class StudioProject
{
    public const STATUS_DRAFT    = 'draft';
    public const STATUS_ACTIVE   = 'active';
    public const STATUS_ARCHIVED = 'archived';

    public static function statuses(): array
    {
        return [self::STATUS_DRAFT, self::STATUS_ACTIVE, self::STATUS_ARCHIVED];
    }

    /**
     * Projects a user can see: their own, plus anything shared with them.
     *
     * Deliberately does NOT select `document` — a list of twenty projects would
     * otherwise ship twenty full documents to render twenty rows of metadata.
     */
    public static function listFor(int $userId, int $limit = 50, int $offset = 0): array
    {
        $sql = 'SELECT p.id, p.uuid, p.owner_id, p.name, p.description, p.schema_version,
                       p.thumbnail_id, p.status, p.size_bytes, p.created_at, p.updated_at,
                       u.display_name AS owner_name,
                       CASE WHEN p.owner_id = ? THEN \'owner\' ELSE s.role END AS access
                FROM studio_projects p
                LEFT JOIN users u ON u.id = p.owner_id
                LEFT JOIN studio_shares s ON s.project_id = p.id AND s.grantee_id = ?
                WHERE p.owner_id = ? OR s.id IS NOT NULL
                ORDER BY p.updated_at DESC, p.id DESC
                LIMIT ' . (int) $limit . ' OFFSET ' . (int) $offset;

        return array_map([self::class, 'hydrate'],
            Database::fetchAll($sql, [$userId, $userId, $userId]));
    }

    public static function countFor(int $userId): int
    {
        return (int) Database::fetchColumn(
            'SELECT COUNT(*) FROM studio_projects p
             LEFT JOIN studio_shares s ON s.project_id = p.id AND s.grantee_id = ?
             WHERE p.owner_id = ? OR s.id IS NOT NULL',
            [$userId, $userId]
        );
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetchOne(
            'SELECT p.*, u.display_name AS owner_name
             FROM studio_projects p
             LEFT JOIN users u ON u.id = p.owner_id
             WHERE p.id = ?',
            [$id]
        );
        return $row ? self::hydrate($row) : null;
    }

    public static function findByUuid(string $uuid): ?array
    {
        $row = Database::fetchOne(
            'SELECT p.*, u.display_name AS owner_name
             FROM studio_projects p
             LEFT JOIN users u ON u.id = p.owner_id
             WHERE p.uuid = ?',
            [$uuid]
        );
        return $row ? self::hydrate($row) : null;
    }

    public static function create(int $ownerId, string $uuid, string $name, ?string $description,
                                  string $documentJson, int $schemaVersion): int
    {
        return Database::insert(
            'INSERT INTO studio_projects
                (uuid, owner_id, name, description, document, schema_version, size_bytes, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [$uuid, $ownerId, $name, $description, $documentJson, $schemaVersion, strlen($documentJson)]
        );
    }

    /**
     * Update whichever fields were supplied.
     *
     * Clauses are literal fragments and every value is bound, so nothing the
     * caller supplies reaches the SQL text.
     */
    public static function update(int $id, array $fields): bool
    {
        $allowed = ['name', 'description', 'document', 'schema_version', 'status', 'thumbnail_id'];
        $set = [];
        $params = [];
        foreach ($allowed as $col) {
            if (!array_key_exists($col, $fields)) continue;
            $set[] = $col . ' = ?';
            $params[] = $fields[$col];
        }
        if (!$set) return false;

        if (array_key_exists('document', $fields)) {
            $set[] = 'size_bytes = ?';
            $params[] = strlen((string) $fields['document']);
        }
        $set[] = 'updated_at = NOW()';
        $params[] = $id;

        return Database::execute(
            'UPDATE studio_projects SET ' . implode(', ', $set) . ' WHERE id = ?',
            $params
        ) > 0;
    }

    public static function delete(int $id): bool
    {
        return Database::execute('DELETE FROM studio_projects WHERE id = ?', [$id]) > 0;
    }

    /** Total bytes a user's documents occupy (assets are counted separately). */
    public static function documentBytes(int $userId): int
    {
        return (int) Database::fetchColumn(
            'SELECT COALESCE(SUM(size_bytes), 0) FROM studio_projects WHERE owner_id = ?',
            [$userId]
        );
    }

    /**
     * Row as the API returns it.
     *
     * `document` is decoded when present and dropped when absent, so a list row
     * and a detail row have the same shape minus the heavy field rather than
     * differing in type.
     */
    public static function hydrate(array $row): array
    {
        if (array_key_exists('document', $row)) {
            $row['document'] = $row['document'] !== null
                ? json_decode((string) $row['document'], true)
                : null;
        }
        foreach (['id', 'owner_id', 'schema_version', 'thumbnail_id', 'size_bytes'] as $k) {
            if (isset($row[$k])) $row[$k] = (int) $row[$k];
        }
        return $row;
    }
}
