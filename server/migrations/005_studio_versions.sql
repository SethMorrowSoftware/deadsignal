-- Media Studio: named snapshots and autosave history.
--
-- Named versions are kept forever; autosaves are pruned to the most recent N
-- per project (oldest first) so a long editing session cannot grow without
-- bound. is_autosave is what separates the two, and it is indexed because the
-- prune query filters on it.
CREATE TABLE IF NOT EXISTS studio_versions (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id  INT UNSIGNED NOT NULL,
    label       VARCHAR(200) NULL,
    document    JSON NOT NULL,
    is_autosave TINYINT(1) NOT NULL DEFAULT 0,
    size_bytes  BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_by  INT UNSIGNED NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_studio_versions_project (project_id, is_autosave, id),
    CONSTRAINT fk_studio_versions_project
        FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_studio_versions_user
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
