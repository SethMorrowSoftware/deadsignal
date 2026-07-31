<?php
/**
 * StudioController — every route the studio backend serves.
 *
 * The studio itself stays a browser tool that works with no backend at all.
 * This adds the things a single browser cannot do: projects that follow you
 * between machines, assets stored somewhere other than IndexedDB, and sharing a
 * project with someone else.
 *
 * Routes:
 *   GET    /studio/config                 Capability profile + this user's quota
 *   GET    /studio/projects               Projects owned by or shared with you
 *   POST   /studio/projects               Create
 *   GET    /studio/projects/:id           One project, with its document
 *   PUT    /studio/projects/:id           Update (editor+)
 *   DELETE /studio/projects/:id           Delete (owner only)
 *   GET    /studio/projects/:id/versions  Snapshot history
 *   POST   /studio/projects/:id/versions  Snapshot now
 *   POST   /studio/versions/:id/restore   Restore a snapshot (editor+)
 *   GET    /studio/projects/:id/shares    Who can see it (owner only)
 *   POST   /studio/projects/:id/shares    Grant a user, or mint a link (owner only)
 *   DELETE /studio/shares/:id             Revoke (owner only)
 *   GET    /studio/shared/:token          Read a project by share link
 *   GET    /studio/assets                 Your assets
 *   POST   /studio/assets/init            Begin/resume a chunked upload
 *   POST   /studio/assets/chunk           Upload one chunk
 *   POST   /studio/assets/complete        Assemble, verify, register
 *   GET    /studio/assets/:id/raw         Download the bytes
 *   DELETE /studio/assets/:id             Delete
 *
 * Every route is authenticated by middleware. Authorisation — who may read or
 * write which project — is decided here, in one place, by requireProject().
 */
class StudioController
{
    private const AUTOSAVE_KEEP = 50;
    private const NAMED_KEEP = 100;

    private function storage(): StudioStorage
    {
        $s = new StudioStorage();
        if (!$s->isEnabled()) {
            // Off by default and off wherever the host cannot support it. Saying
            // so plainly beats failing later in a way that looks like a bug.
            jsonError('The studio backend is not enabled on this server.', 503);
        }
        return $s;
    }

    /**
     * Refuse a document/version write that would push the OWNER over quota.
     *
     * Asset uploads were metered but document and version writes were not, so a
     * project or version could grow the store without bound — and versions are
     * charged to the project owner, so a shared-project editor could fill the
     * owner's quota. Charged to $ownerId for exactly that reason. A quota of 0
     * means unlimited (the storage layer's own convention).
     */
    private function assertQuotaForWrite(StudioStorage $storage, int $ownerId, int $addBytes): void
    {
        $quota = $storage->userQuota();
        if ($quota <= 0) return;
        if ($storage->usageFor($ownerId) + $addBytes > $quota) {
            jsonError('This would exceed the account storage quota (' . $quota . ' bytes)', 413);
        }
    }

    private function userId(): int
    {
        $u = currentUser();
        if (!$u) jsonError('Authentication required', 401);
        return (int) $u['id'];
    }

    /**
     * Load a project and assert this user has at least $needed access.
     *
     * One chokepoint for every project route, so a new endpoint cannot forget
     * the check. 404 rather than 403 for a project you cannot see: telling a
     * stranger that id 12 exists is itself a disclosure.
     */
    private function requireProject($id, string $needed): array
    {
        // The enabled gate must hold on EVERY studio route, not just the ones
        // that happen to touch storage — a disabled studio that still serves
        // reads, restores and freshly minted share links is not disabled.
        $this->storage();
        $project = ctype_digit((string) $id)
            ? StudioProject::findById((int) $id)
            : StudioProject::findByUuid((string) $id);
        if (!$project) jsonError('Project not found', 404);

        $uid = $this->userId();
        $role = StudioShare::roleFor((int) $project['id'], $uid, (int) $project['owner_id']);
        if ($role === null) jsonError('Project not found', 404);
        if (!StudioShare::allows($role, $needed)) {
            jsonError('You do not have permission to do that', 403);
        }
        $project['access'] = $role;
        return $project;
    }

    /** Validate an incoming document and return it as compact JSON. */
    private function documentJson($doc, StudioStorage $storage): string
    {
        if (!is_array($doc)) jsonError('document must be an object');
        // Reserved keys anywhere in the tree. The client has its own guard, but
        // a request does not have to come from the client.
        if (self::hasReservedKey($doc)) {
            jsonError('document contains a reserved key (__proto__ / constructor / prototype)');
        }
        $json = json_encode($doc, JSON_UNESCAPED_SLASHES);
        if ($json === false) jsonError('document could not be encoded');
        if (strlen($json) > $storage->maxDocumentSize()) {
            jsonError('document is larger than this server allows ('
                . $storage->maxDocumentSize() . ' bytes)', 413);
        }
        return $json;
    }

    /** Recursive reserved-key scan. Depth-bounded so a deep payload cannot hang it. */
    public static function hasReservedKey($node, int $depth = 0): bool
    {
        if ($depth > 64 || !is_array($node)) return false;
        foreach ($node as $k => $v) {
            if (is_string($k) && in_array($k, ['__proto__', 'constructor', 'prototype'], true)) {
                return true;
            }
            if (is_array($v) && self::hasReservedKey($v, $depth + 1)) return true;
        }
        return false;
    }

    /* ------------------------------------------------------------ config -- */

    public function config(array $params): void
    {
        $s = new StudioStorage();
        if (!$s->isEnabled()) {
            jsonResponse(['enabled' => false]);
            return;
        }
        jsonResponse([
            'enabled'         => true,
            'chunkSize'       => $s->chunkSize(),
            'maxAssetSize'    => $s->maxAssetSize(),
            'maxDocumentSize' => $s->maxDocumentSize(),
            'quota'           => $s->quotaInfo($this->userId()),
        ]);
    }

    /* ---------------------------------------------------------- projects -- */

    public function listProjects(array $params): void
    {
        $this->storage();
        $uid = $this->userId();
        $limit  = max(1, min(200, (int) ($_GET['limit'] ?? 50)));
        $offset = max(0, (int) ($_GET['offset'] ?? 0));
        jsonResponse([
            'projects' => StudioProject::listFor($uid, $limit, $offset),
            'total'    => StudioProject::countFor($uid),
            'limit'    => $limit,
            'offset'   => $offset,
        ]);
    }

    public function createProject(array $params): void
    {
        $storage = $this->storage();
        $uid = $this->userId();

        $name = trim((string) input('name', ''));
        if ($name === '') jsonError('name is required');
        if (mb_strlen($name) > 200) jsonError('name is too long');

        $json = $this->documentJson(input('document', []), $storage);
        $this->assertQuotaForWrite($storage, $uid, strlen($json));
        $uuid = self::uuid();

        $id = StudioProject::create(
            $uid, $uuid, $name,
            self::nullableText(input('description')),
            $json,
            max(1, (int) input('schemaVersion', 1))
        );

        jsonResponse(['project' => StudioProject::findById($id)], 201);
    }

    public function getProject(array $params): void
    {
        jsonResponse(['project' => $this->requireProject($params['id'] ?? '', StudioShare::ROLE_VIEWER)]);
    }

    public function updateProject(array $params): void
    {
        $storage = $this->storage();
        $project = $this->requireProject($params['id'] ?? '', StudioShare::ROLE_EDITOR);

        $fields = [];
        if (input('name') !== null) {
            $name = trim((string) input('name'));
            if ($name === '') jsonError('name cannot be empty');
            $fields['name'] = $name;
        }
        if (input('description') !== null) $fields['description'] = self::nullableText(input('description'));
        if (input('status') !== null) {
            $status = (string) input('status');
            if (!in_array($status, StudioProject::statuses(), true)) jsonError('Invalid status');
            $fields['status'] = $status;
        }
        if (input('document') !== null) {
            $fields['document'] = $this->documentJson(input('document'), $storage);
            $fields['schema_version'] = max(1, (int) input('schemaVersion', $project['schema_version'] ?? 1));
            // Charged to the owner, not the editor making the change.
            $this->assertQuotaForWrite($storage, (int) $project['owner_id'], strlen($fields['document']));

            // Autosave a snapshot of what is being replaced, so an accidental
            // overwrite from another machine is recoverable rather than final.
            if (input('snapshot', true)) {
                StudioVersion::create(
                    (int) $project['id'],
                    json_encode($project['document'], JSON_UNESCAPED_SLASHES),
                    null, true, $this->userId()
                );
                StudioVersion::pruneAutosaves((int) $project['id'], self::AUTOSAVE_KEEP);
            }
        }
        if (!$fields) jsonError('Nothing to update');

        StudioProject::update((int) $project['id'], $fields);
        jsonResponse(['project' => StudioProject::findById((int) $project['id'])]);
    }

    public function deleteProject(array $params): void
    {
        // Owner only — an editor can change a project, not destroy it.
        $project = $this->requireProject($params['id'] ?? '', StudioShare::ROLE_OWNER);
        StudioProject::delete((int) $project['id']);
        jsonResponse(['deleted' => true]);
    }

    /* ---------------------------------------------------------- versions -- */

    public function listVersions(array $params): void
    {
        $project = $this->requireProject($params['id'] ?? '', StudioShare::ROLE_VIEWER);
        jsonResponse(['versions' => StudioVersion::listFor((int) $project['id'])]);
    }

    public function createVersion(array $params): void
    {
        $project = $this->requireProject($params['id'] ?? '', StudioShare::ROLE_EDITOR);
        $label = self::nullableText(input('label'));
        $doc = json_encode($project['document'], JSON_UNESCAPED_SLASHES);
        // Charged to the owner; named versions were unmetered and never pruned.
        $this->assertQuotaForWrite($this->storage(), (int) $project['owner_id'], strlen($doc));
        $id = StudioVersion::create(
            (int) $project['id'], $doc, $label, false, $this->userId()
        );
        // Bound the count the way autosaves are bounded, so history cannot grow
        // without limit even for a project that stays under quota.
        StudioVersion::pruneNamed((int) $project['id'], self::NAMED_KEEP);
        jsonResponse(['version' => StudioVersion::findById($id)], 201);
    }

    public function restoreVersion(array $params): void
    {
        $version = StudioVersion::findById((int) ($params['id'] ?? 0));
        if (!$version) jsonError('Version not found', 404);
        // Authorise against the project, not the version — the version id alone
        // says nothing about who may use it.
        $project = $this->requireProject((string) $version['project_id'], StudioShare::ROLE_EDITOR);

        $restored = json_encode($version['document'], JSON_UNESCAPED_SLASHES);
        // The autosave snapshot below is pruned, but the restored document itself
        // is a fresh write charged to the owner — gate it like any other.
        $this->assertQuotaForWrite($this->storage(), (int) $project['owner_id'], strlen($restored));

        // Snapshot the current state first: restoring is itself a change worth
        // being able to undo.
        StudioVersion::create((int) $project['id'],
            json_encode($project['document'], JSON_UNESCAPED_SLASHES), null, true, $this->userId());
        StudioVersion::pruneAutosaves((int) $project['id'], self::AUTOSAVE_KEEP);

        StudioProject::update((int) $project['id'], [
            'document' => $restored,
        ]);
        jsonResponse(['project' => StudioProject::findById((int) $project['id'])]);
    }

    /* ------------------------------------------------------------ shares -- */

    public function listShares(array $params): void
    {
        $project = $this->requireProject($params['id'] ?? '', StudioShare::ROLE_OWNER);
        jsonResponse(['shares' => StudioShare::listFor((int) $project['id'])]);
    }

    public function createShare(array $params): void
    {
        $project = $this->requireProject($params['id'] ?? '', StudioShare::ROLE_OWNER);
        $role = (string) input('role', StudioShare::ROLE_VIEWER);
        $uid  = $this->userId();

        if (input('user') !== null) {
            if (!in_array($role, StudioShare::grantableRoles(), true)) jsonError('Invalid role');
            // Accept a display name or a uuid — the two things a person can
            // actually be told by the person they are collaborating with.
            $needle = trim((string) input('user'));
            $user = User::findByDisplayName($needle) ?? User::findByUuid($needle);
            if (!$user) jsonError('No such user', 404);
            if ((int) $user['id'] === (int) $project['owner_id']) {
                jsonError('That user already owns this project');
            }
            $id = StudioShare::grantToUser((int) $project['id'], (int) $user['id'], $role, $uid);
            jsonResponse(['share' => StudioShare::findById($id)], 201);
            return;
        }

        // A link. Editor is deliberately not offered: an editor grant always
        // requires a named account, so it can be revoked for one person.
        if (!in_array($role, StudioShare::linkRoles(), true)) {
            jsonError('A share link can only grant viewer or commenter access');
        }
        $token = bin2hex(random_bytes(32));
        $expiresInSeconds = null;
        if (input('expiresInDays') !== null) {
            $days = max(1, min(365, (int) input('expiresInDays')));
            $expiresInSeconds = $days * 86400;
        }
        $id = StudioShare::createLink((int) $project['id'], $token, $role, $expiresInSeconds, $uid);

        // The token is returned exactly once, here. It is not in any listing.
        jsonResponse([
            'share' => StudioShare::findById($id),
            'token' => $token,
        ], 201);
    }

    public function revokeShare(array $params): void
    {
        $share = StudioShare::findById((int) ($params['id'] ?? 0));
        if (!$share) jsonError('Share not found', 404);
        $this->requireProject((string) $share['project_id'], StudioShare::ROLE_OWNER);
        StudioShare::revoke((int) $share['id']);
        jsonResponse(['revoked' => true]);
    }

    /**
     * GET /studio/shared/:token — read a project through a share link.
     *
     * PUBLIC: a link has to work for someone without an account, which is the
     * whole point of it existing alongside named grants. The token is the
     * credential — 256 bits, revocable, and optionally expiring.
     *
     * Read-only by construction: link roles are viewer/commenter and this
     * endpoint has no write counterpart. The owner's identity is stripped, so a
     * link discloses the work and nothing about the person who made it.
     */
    public function getShared(array $params): void
    {
        // Disabling the studio must also stop previously minted links serving
        // project content to anonymous visitors.
        $this->storage();
        $token = (string) ($params['token'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) jsonError('Invalid link', 404);
        $share = StudioShare::findByToken($token);
        if (!$share) jsonError('This link is not valid or has expired', 404);

        $project = StudioProject::findById((int) $share['project_id']);
        if (!$project) jsonError('Project not found', 404);
        $project['access'] = $share['role'];
        // An anonymous reader has no business knowing who owns this or what
        // else lives on the server.
        unset($project['owner_id'], $project['owner_name'], $project['thumbnail_id']);
        jsonResponse(['project' => $project, 'readOnly' => true]);
    }

    /* ------------------------------------------------------------ assets -- */

    public function listAssets(array $params): void
    {
        $storage = $this->storage();
        $uid = $this->userId();
        $projectId = isset($_GET['projectId']) ? (int) $_GET['projectId'] : null;
        if ($projectId) $this->requireProject((string) $projectId, StudioShare::ROLE_VIEWER);
        // Paged like listProjects: without limit/offset and a total, anything
        // past the newest page was invisible — and undeletable — while still
        // counting against quota.
        $limit  = max(1, min(500, (int) ($_GET['limit'] ?? 200)));
        $offset = max(0, (int) ($_GET['offset'] ?? 0));
        jsonResponse([
            'assets' => StudioAsset::listFor($uid, $projectId, $limit, $offset),
            'total'  => StudioAsset::countFor($uid, $projectId),
            'limit'  => $limit,
            'offset' => $offset,
            'quota'  => $storage->quotaInfo($uid),
        ]);
    }

    public function initUpload(array $params): void
    {
        $storage = $this->storage();

        // Abandoned upload sessions have no other reaper: shared hosts rarely
        // get a cron, so the sweep rides the request path probabilistically —
        // the same pattern the router uses for expired sessions. A day-old tmp
        // directory is not a resumable upload, it is leaked disk.
        if (mt_rand(1, 20) === 1) {
            try { $storage->sweepStaleUploads(); } catch (\Throwable $e) { /* never blocks an upload */ }
        }

        $sha  = strtolower(trim((string) input('sha256', '')));
        $size = (int) input('size', 0);

        // Already stored: skip the transfer entirely. Re-exporting an unchanged
        // clip is byte-identical by design, so this is the common case — and it
        // must be answered BEFORE the quota check inside initUpload, which
        // counts the stored copy of these very bytes and would refuse a
        // re-upload that needs zero new storage.
        $existing = StudioStorage::isValidSha($sha)
            ? StudioAsset::findBySha($this->userId(), $sha) : null;
        if ($existing) {
            jsonResponse([
                'uploadId'        => null,
                'chunkSize'       => $storage->chunkSize(),
                'received'        => [],
                'alreadyUploaded' => true,
                'asset'           => $existing,
            ]);
            return;
        }

        try {
            $r = $storage->initUpload($this->userId(), $size, $sha, input('uploadId'));
        } catch (\RuntimeException $e) {
            jsonError($e->getMessage());
            return;
        }
        jsonResponse($r);
    }

    public function uploadChunk(array $params): void
    {
        $storage = $this->storage();
        // A request over post_max_size is silently discarded by PHP — $_POST
        // and $_FILES arrive empty while the body did not. Name the cause;
        // "No chunk received" gave the user nothing to act on.
        if (empty($_POST) && empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
            jsonError('The chunk exceeded this server\'s post_max_size — lower the configured chunk size or raise the PHP limit', 413);
        }
        $uploadId = (string) ($_POST['uploadId'] ?? '');
        $index = (int) ($_POST['index'] ?? -1);
        $file = $_FILES['chunk'] ?? null;
        if (!$file || !empty($file['error'])) jsonError('No chunk received');

        try {
            $storage->storeChunk($this->userId(), $uploadId, $index, (string) $file['tmp_name']);
        } catch (\RuntimeException $e) {
            jsonError($e->getMessage());
            return;
        }
        jsonResponse(['received' => $storage->receivedChunks($uploadId)]);
    }

    public function completeUpload(array $params): void
    {
        $storage = $this->storage();
        $uid = $this->userId();
        $uploadId = (string) input('uploadId', '');
        $sha = strtolower(trim((string) input('sha256', '')));
        $size = (int) input('size', 0);

        // Authorise the target project BEFORE any bytes are committed. Assembling
        // the upload renames the file into its final path; if the authorisation
        // below runs afterwards and fails, requireProject() exits and the asset
        // row is never created — leaving an orphan file that usageFor() never
        // counts (it sums rows, not loose files) and the stale-upload sweep never
        // reaps (it only touches tmp/), so the same low quota reading admits the
        // next upload and the next: an unbounded quota bypass / disk filler.
        $projectId = input('projectId') !== null ? (int) input('projectId') : null;
        if ($projectId) $this->requireProject((string) $projectId, StudioShare::ROLE_EDITOR);

        try {
            $r = $storage->completeUpload($uid, $uploadId, $sha, $size);
        } catch (\RuntimeException $e) {
            jsonError($e->getMessage());
            return;
        }

        $existing = StudioAsset::findBySha($uid, $sha);
        if ($existing) { jsonResponse(['asset' => $existing, 'deduped' => true]); return; }

        $kind = (string) input('kind', 'other');
        if (!in_array($kind, StudioAsset::KINDS, true)) $kind = 'other';

        $id = StudioAsset::create([
            'owner_id'      => $uid,
            'project_id'    => $projectId,
            'sha256'        => $sha,
            'kind'          => $kind,
            'original_name' => mb_substr((string) input('name', ''), 0, 255),
            'mime_type'     => $r['mime'],
            'size'          => $r['size'],
            'storage_path'  => $r['path'],
            'metadata'      => is_array(input('metadata')) ? input('metadata') : null,
        ]);

        jsonResponse(['asset' => StudioAsset::findById($id), 'deduped' => $r['deduped']], 201);
    }

    /** GET /studio/assets/:id/raw — stream the bytes. */
    public function downloadAsset(array $params): void
    {
        $storage = $this->storage();
        $asset = StudioAsset::findById((int) ($params['id'] ?? 0));
        if (!$asset) jsonError('Asset not found', 404);
        if ((int) $asset['owner_id'] !== $this->userId()) jsonError('Asset not found', 404);

        $path = $storage->assetPath((int) $asset['owner_id'], (string) $asset['sha256']);
        if (!is_file($path)) jsonError('The stored file is missing', 410);

        // Content-Disposition holds a user-supplied filename. The plain
        // filename= is an ASCII-safe fallback with anything that could break
        // out of the header stripped; the RFC 5987 filename*= carries the real
        // name percent-encoded, so a non-ASCII name downloads as itself rather
        // than as underscores.
        $original = (string) $asset['original_name'];
        $ascii = preg_replace('/[^A-Za-z0-9._-]/', '_', $original) ?: 'asset';
        $disposition = 'attachment; filename="' . $ascii . '"';
        if ($original !== '' && $original !== $ascii) {
            $disposition .= "; filename*=UTF-8''" . rawurlencode($original);
        }
        header('Content-Type: ' . ($asset['mime_type'] ?: 'application/octet-stream'));
        header('Content-Length: ' . (string) filesize($path));
        header('Content-Disposition: ' . $disposition);
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    public function deleteAsset(array $params): void
    {
        $storage = $this->storage();
        $asset = StudioAsset::findById((int) ($params['id'] ?? 0));
        if (!$asset) jsonError('Asset not found', 404);
        if ((int) $asset['owner_id'] !== $this->userId()) jsonError('Asset not found', 404);

        StudioAsset::delete((int) $asset['id']);
        // Only remove the file once nothing else references those bytes —
        // dedupe means two rows can share one file.
        if (!StudioAsset::shaInUse((int) $asset['owner_id'], (string) $asset['sha256'], (int) $asset['id'])) {
            $storage->deleteAssetFile((int) $asset['owner_id'], (string) $asset['sha256']);
        }
        jsonResponse(['deleted' => true]);
    }

    /** PATCH /studio/assets/:id — rename (owner only). */
    public function renameAsset(array $params): void
    {
        $this->storage();
        $asset = StudioAsset::findById((int) ($params['id'] ?? 0));
        // 404, not 403, for someone else's asset — the same non-disclosure the
        // project routes keep.
        if (!$asset || (int) $asset['owner_id'] !== $this->userId()) jsonError('Asset not found', 404);
        $name = trim((string) input('name', ''));
        if ($name === '') jsonError('name is required');
        if (mb_strlen($name) > 255) jsonError('name is too long');
        StudioAsset::rename((int) $asset['id'], $name);
        jsonResponse(['asset' => StudioAsset::findById((int) $asset['id'])]);
    }

    /* ------------------------------------------------------------- extras -- */

    /** POST /studio/projects/:id/duplicate — copy into the caller's own account. */
    public function duplicateProject(array $params): void
    {
        $storage = $this->storage();
        // Viewer access is enough: duplicating a project shared with you into your
        // OWN account is how a read-only share becomes something you can edit,
        // without touching the original. The copy is owned by the caller.
        $src = $this->requireProject($params['id'] ?? '', StudioShare::ROLE_VIEWER);
        $uid = $this->userId();

        $name = trim((string) input('name', ''));
        if ($name === '') $name = mb_substr(((string) $src['name']) . ' (copy)', 0, 200);
        if (mb_strlen($name) > 200) jsonError('name is too long');

        // requireProject returns the document already decoded to an array
        // (StudioProject::hydrate); re-encode it through the shared guard so the
        // copy is stored as valid JSON, size-checked like any other write.
        $json = $this->documentJson(is_array($src['document'] ?? null) ? $src['document'] : [], $storage);
        // Charged to the caller, who now owns the copy.
        $this->assertQuotaForWrite($storage, $uid, strlen($json));

        $id = StudioProject::create(
            $uid, self::uuid(), $name,
            self::nullableText($src['description'] ?? null),
            $json,
            max(1, (int) ($src['schema_version'] ?? 1))
        );
        jsonResponse(['project' => StudioProject::findById($id)], 201);
    }

    /** GET /studio/usage — this account's storage picture, in one call. */
    public function usage(array $params): void
    {
        $s = $this->storage();
        $uid = $this->userId();
        jsonResponse([
            'quota'    => $s->quotaInfo($uid),
            'projects' => StudioProject::countFor($uid),
            'assets'   => StudioAsset::countFor($uid),
        ]);
    }

    /* ------------------------------------------------------------ helpers -- */

    private static function nullableText($v): ?string
    {
        if ($v === null) return null;
        $s = trim((string) $v);
        return $s === '' ? null : mb_substr($s, 0, 4000);
    }

    public static function uuid(): string
    {
        $d = random_bytes(16);
        $d[6] = chr(ord($d[6]) & 0x0f | 0x40);
        $d[8] = chr(ord($d[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
    }
}
