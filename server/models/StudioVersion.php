<?php
/**
 * StudioVersion - Named snapshots and autosave history for a project.
 *
 * Named versions are permanent; autosaves are pruned to the most recent N so a
 * long editing session cannot grow the table without bound. Pruning by id
 * rather than timestamp is deliberate: two autosaves inside the same second are
 * ordinary, and TIMESTAMP has one-second resolution.
 */
class StudioVersion
{
    /**
     * Every named version, plus the newest $autosaveLimit autosaves.
     *
     * Named rows must ALWAYS appear no matter how many autosaves outrank them
     * by id: every save creates an autosave and AUTOSAVE_KEEP retains 50, so a
     * single flat "newest 50" listing filled up with autosaves after one
     * ordinary editing session and the permanent snapshots became unreachable —
     * still in the table, but invisible to the only listing endpoint.
     */
    public static function listFor(int $projectId, int $autosaveLimit = 50): array
    {
        $autosaveLimit = max(1, min(500, $autosaveLimit));
        return array_map([self::class, 'hydrate'], Database::fetchAll(
            'SELECT id, project_id, label, is_autosave, size_bytes, created_by, created_at
             FROM studio_versions WHERE project_id = ? AND is_autosave = 0
             UNION ALL
             SELECT id, project_id, label, is_autosave, size_bytes, created_by, created_at
             FROM (
                 SELECT id, project_id, label, is_autosave, size_bytes, created_by, created_at
                 FROM studio_versions WHERE project_id = ? AND is_autosave = 1
                 ORDER BY id DESC LIMIT ' . (int) $autosaveLimit . '
             ) AS recent_autosaves
             ORDER BY id DESC',
            [$projectId, $projectId]
        ));
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetchOne('SELECT * FROM studio_versions WHERE id = ?', [$id]);
        return $row ? self::hydrate($row) : null;
    }

    public static function create(int $projectId, string $documentJson, ?string $label,
                                  bool $isAutosave, ?int $userId): int
    {
        return Database::insert(
            'INSERT INTO studio_versions (project_id, label, document, is_autosave, size_bytes, created_by)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$projectId, $label, $documentJson, $isAutosave ? 1 : 0, strlen($documentJson), $userId]
        );
    }

    /**
     * Keep the newest $keep autosaves for a project; delete the rest.
     *
     * The subquery is wrapped in a derived table because MySQL refuses to
     * DELETE from a table it is also selecting from directly.
     */
    public static function pruneAutosaves(int $projectId, int $keep): int
    {
        $keep = max(1, min(500, $keep));
        return Database::execute(
            'DELETE FROM studio_versions
             WHERE project_id = ? AND is_autosave = 1 AND id NOT IN (
                 SELECT id FROM (
                     SELECT id FROM studio_versions
                     WHERE project_id = ? AND is_autosave = 1
                     ORDER BY id DESC LIMIT ' . (int) $keep . '
                 ) AS keepers
             )',
            [$projectId, $projectId]
        );
    }

    public static function hydrate(array $row): array
    {
        foreach (['id', 'project_id', 'size_bytes', 'created_by'] as $k) {
            if (isset($row[$k])) $row[$k] = (int) $row[$k];
        }
        if (isset($row['is_autosave'])) $row['is_autosave'] = (bool) $row['is_autosave'];
        if (array_key_exists('document', $row)) {
            $row['document'] = $row['document'] !== null
                ? json_decode((string) $row['document'], true) : null;
        }
        return $row;
    }
}
