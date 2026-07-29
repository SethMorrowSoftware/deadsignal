-- Sign-in tokens. One row per live session.
--
-- Tokens are 64 random bytes as hex, sent as `Authorization: Bearer` and never
-- in a URL. Expired rows are swept probabilistically on the request path,
-- because a shared host rarely has a cron.
CREATE TABLE IF NOT EXISTS sessions (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token       VARCHAR(128) NOT NULL,
    user_id     INT UNSIGNED NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  TIMESTAMP NULL,
    user_agent  VARCHAR(255) NULL,
    ip_address  VARCHAR(45) NULL,
    UNIQUE KEY uniq_sessions_token (token),
    KEY idx_sessions_user_id (user_id),
    KEY idx_sessions_expires_at (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
