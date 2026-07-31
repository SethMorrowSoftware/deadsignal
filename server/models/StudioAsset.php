<?php
/**
 * StudioAsset - A binary belonging to a Media Studio user.
 *
 * Content-addressed by sha256 and deduped per owner: uploading the same file
 * twice is one row and one file on disk, not two. That matters here more than
 * usual because re-exporting a clip with unchanged settings produces a
 * byte-identical result by design.
 */
class StudioAsset
{
    public const KINDS = ['video', 'audio', 'image', 'font', 'lut', 'pack', 'other'];

    public static function listFor(int $ownerId, ?int $projectId = null, int $limit = 200, int $offset = 0): array
    {
        $sql = 'SELECT * FROM studio_assets WHERE owner_id = ?';
        $params = [$ownerId];
        if ($projectId !== null) {
            $sql .= ' AND project_id = ?';
            $params[] = $projectId;
        }
        $sql .= ' ORDER BY created_at DESC, id DESC LIMIT ' . (int) $limit . ' OFFSET ' . (int) $offset;
        return array_map([self::class, 'hydrate'], Database::fetchAll($sql, $params));
    }

    public static function countFor(int $ownerId, ?int $projectId = null): int
    {
        $sql = 'SELECT COUNT(*) FROM studio_assets WHERE owner_id = ?';
        $params = [$ownerId];
        if ($projectId !== null) {
            $sql .= ' AND project_id = ?';
            $params[] = $projectId;
        }
        return (int) Database::fetchColumn($sql, $params);
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetchOne('SELECT * FROM studio_assets WHERE id = ?', [$id]);
        return $row ? self::hydrate($row) : null;
    }

    /** The dedupe lookup: same owner, same bytes. */
    public static function findBySha(int $ownerId, string $sha): ?array
    {
        $row = Database::fetchOne(
            'SELECT * FROM studio_assets WHERE owner_id = ? AND sha256 = ?',
            [$ownerId, $sha]
        );
        return $row ? self::hydrate($row) : null;
    }

    public static function create(array $a): int
    {
        return Database::insert(
            'INSERT INTO studio_assets
                (owner_id, project_id, sha256, kind, original_name, mime_type, size, storage_path, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $a['owner_id'], $a['project_id'] ?? null, $a['sha256'], $a['kind'],
                $a['original_name'], $a['mime_type'], $a['size'], $a['storage_path'],
                isset($a['metadata']) ? json_encode($a['metadata']) : null,
            ]
        );
    }

    public static function delete(int $id): bool
    {
        return Database::execute('DELETE FROM studio_assets WHERE id = ?', [$id]) > 0;
    }

    /** Rename an asset's display name. The value is bound, never interpolated. */
    public static function rename(int $id, string $name): bool
    {
        return Database::execute(
            'UPDATE studio_assets SET original_name = ? WHERE id = ?',
            [$name, $id]
        ) > 0;
    }

    /** Bytes this owner's assets occupy. Deduped rows count once, as they should. */
    public static function quotaUsage(int $ownerId): int
    {
        return (int) Database::fetchColumn(
            'SELECT COALESCE(SUM(size), 0) FROM studio_assets WHERE owner_id = ?',
            [$ownerId]
        );
    }

    /** Is any OTHER row still pointing at this file on disk? */
    public static function shaInUse(int $ownerId, string $sha, int $exceptId): bool
    {
        return (int) Database::fetchColumn(
            'SELECT COUNT(*) FROM studio_assets WHERE owner_id = ? AND sha256 = ? AND id <> ?',
            [$ownerId, $sha, $exceptId]
        ) > 0;
    }

    public static function hydrate(array $row): array
    {
        foreach (['id', 'owner_id', 'project_id', 'size'] as $k) {
            if (isset($row[$k])) $row[$k] = (int) $row[$k];
        }
        if (isset($row['metadata'])) {
            $row['metadata'] = $row['metadata'] !== null
                ? json_decode((string) $row['metadata'], true) : null;
        }
        // The on-disk location is an implementation detail and knowing it helps
        // nobody but an attacker; downloads go through /studio/assets/:id/raw.
        unset($row['storage_path']);
        return $row;
    }
}
