-- Media Studio: sharing a project.
--
-- A row is EITHER a named grant (grantee_id) OR an unguessable link
-- (link_token) — never both. The controller enforces that, and the two unique
-- keys make each kind unique on its own terms.
--
-- Link tokens are 256-bit and viewer/commenter only: an editor grant always
-- requires a named account, because "whoever has the URL can edit" is not a
-- permission model anyone can reason about or revoke per person.
CREATE TABLE IF NOT EXISTS studio_shares (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id      INT UNSIGNED NOT NULL,
    grantee_id      INT UNSIGNED NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'viewer',
    link_token      CHAR(64) NULL,
    link_expires_at TIMESTAMP NULL,
    created_by      INT UNSIGNED NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_studio_shares_grantee (project_id, grantee_id),
    UNIQUE KEY uniq_studio_shares_token (link_token),
    KEY idx_studio_shares_project (project_id),
    CONSTRAINT fk_studio_shares_project
        FOREIGN KEY (project_id) REFERENCES studio_projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_studio_shares_grantee
        FOREIGN KEY (grantee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_studio_shares_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
