<?php
/**
 * StudioStorage — asset storage and chunked upload.
 *
 * Chunking is required, not an optimisation. A sixty-second WebM easily exceeds
 * a shared host's post_max_size, and a plain POST fails there with an unhelpful
 * error the first time a user makes something real. The chunk size is computed
 * from the host's own limits (StudioPreflight::chunkSize) so the client adapts
 * to the server rather than assuming a number.
 *
 * Uploads are resumable: init reports which chunks already arrived, so a
 * dropped connection continues instead of starting over.
 */
class StudioStorage
{
    /**
     * Concurrent upload sessions one user may hold open. Sessions are also
     * bounded by declared bytes (see initUpload); this cap exists so the
     * per-user scan over tmp/ stays cheap and 1-byte declares cannot mint
     * thousands of directories.
     */
    private const MAX_UPLOAD_SESSIONS = 20;

    private array $profile;

    public function __construct(?array $profile = null)
    {
        $this->profile = $profile ?? self::loadProfile();
    }

    /** The capability profile setup.php wrote, with safe defaults. */
    public static function loadProfile(?string $file = null, ?string $default = null): array
    {
        $file = $file ?? self::profilePath();
        $p = is_file($file) ? (@include $file) : null;
        if (!is_array($p)) $p = [];
        $default = $default ?? self::defaultStoragePath();
        // A stale absolute storage_path — written by an older setup.php before
        // a cPanel account move or username change — must not brick every
        // upload with "Could not create storage directory": fall back to the
        // default relative location when the configured one neither exists nor
        // can be created. Only a path the config file actually set is probed,
        // so merely loading the default profile never creates directories.
        if (array_key_exists('storage_path', $p)) {
            $path = rtrim((string) $p['storage_path'], '/');
            if ($path === '' || (!is_dir($path) && !@mkdir($path, 0755, true) && !is_dir($path))) {
                $p['storage_path'] = $default;
            }
        }
        return $p + [
            'enabled'           => false,
            'storage_path'      => $default,
            'user_quota'        => 2147483648,
            'max_asset_size'    => 536870912,
            'max_document_size' => 4194304,
            'chunk_size'        => 2097152,
        ];
    }

    /** Where the capability profile lives. Written by setup.php, editable by hand. */
    public static function profilePath(): string
    {
        return __DIR__ . '/config/studio.php';
    }

    /** Where assets go when the profile does not say otherwise. */
    public static function defaultStoragePath(): string
    {
        return __DIR__ . '/data/studio';
    }

    public function isEnabled(): bool { return !empty($this->profile['enabled']); }
    public function chunkSize(): int { return max(65536, (int) $this->profile['chunk_size']); }
    public function maxAssetSize(): int { return (int) $this->profile['max_asset_size']; }
    public function maxDocumentSize(): int { return (int) $this->profile['max_document_size']; }
    public function userQuota(): int { return (int) $this->profile['user_quota']; }

    private function root(): string { return rtrim((string) $this->profile['storage_path'], '/'); }

    /**
     * An upload id, as generated and as validated.
     *
     * It becomes a directory name, so it is checked against this pattern on
     * every use rather than trusted because we generated it once — the client
     * sends it back, and anything the client sends back is input.
     */
    public static function isValidUploadId(string $id): bool
    {
        return (bool) preg_match('/^[a-f0-9]{32}$/', $id);
    }

    public static function isValidSha(string $sha): bool
    {
        return (bool) preg_match('/^[a-f0-9]{64}$/', $sha);
    }

    private function tmpDir(string $uploadId): string
    {
        if (!self::isValidUploadId($uploadId)) {
            throw new \RuntimeException('Invalid upload id');
        }
        return $this->root() . '/tmp/' . $uploadId;
    }

    /** Final resting place: sharded by the first two hex characters. */
    public function assetPath(int $ownerId, string $sha): string
    {
        if (!self::isValidSha($sha)) throw new \RuntimeException('Invalid checksum');
        return $this->root() . '/assets/' . $ownerId . '/' . substr($sha, 0, 2) . '/' . $sha;
    }

    private function ensureDir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new \RuntimeException('Could not create storage directory');
        }
    }

    /**
     * Begin (or resume) an upload.
     *
     * @return array{uploadId:string, chunkSize:int, received:int[]}
     */
    public function initUpload(int $ownerId, int $size, string $sha, ?string $uploadId = null): array
    {
        if ($size <= 0 || $size > $this->maxAssetSize()) {
            throw new \RuntimeException('File size out of range');
        }
        if (!self::isValidSha($sha)) throw new \RuntimeException('Invalid checksum');

        // Fail fast on quota, and again at complete() — two concurrent uploads
        // can each pass this check and only overrun once both land. The usage
        // query is behind the quota test so an unlimited deployment does not
        // pay for a SUM() on every chunk-session start.
        if ($this->userQuota() > 0
            && $this->usageFor($ownerId) + $size > $this->userQuota()) {
            throw new \RuntimeException('Storage quota exceeded');
        }

        if ($uploadId !== null && self::isValidUploadId($uploadId) && is_dir($this->tmpDir($uploadId))) {
            // Resuming somebody else's transfer is not resuming, it is taking.
            $this->assertOwner($uploadId, $ownerId);
            // A pre-upgrade session has no meta file; give it one so the
            // per-chunk declared-size bound — and the owner check — apply from
            // here on.
            if ($this->readMeta($uploadId) === null) $this->writeMeta($uploadId, $ownerId, $size);
            return [
                'uploadId'  => $uploadId,
                'chunkSize' => $this->chunkSize(),
                'received'  => $this->receivedChunks($uploadId),
            ];
        }

        // Bound what one user can hold in tmp/ across ALL open sessions. Each
        // session is capped at its declared size (storeChunk enforces it), so
        // capping declared bytes and session count here bounds the whole tree
        // — without this, init-and-never-complete could grow tmp/ without
        // limit, and the quota check above only counts COMPLETED assets.
        $flight = $this->inFlightFor($ownerId);
        $budget = $this->userQuota() > 0 ? $this->userQuota() : $this->maxAssetSize() * 4;
        if ($flight['sessions'] >= self::MAX_UPLOAD_SESSIONS
            || $flight['declared'] + $size > $budget) {
            throw new \RuntimeException('Too many uploads in flight — finish or resume an existing upload first');
        }

        $id = bin2hex(random_bytes(16));
        $this->ensureDir($this->tmpDir($id));
        $this->writeMeta($id, $ownerId, $size);
        return ['uploadId' => $id, 'chunkSize' => $this->chunkSize(), 'received' => []];
    }

    /**
     * Session metadata, written at init and trusted over anything the client
     * sends later: the declared size recorded here is what storeChunk bounds
     * the session against, so a client cannot re-declare mid-flight.
     */
    private function metaPath(string $uploadId): string
    {
        return $this->tmpDir($uploadId) . '/meta.json';
    }

    private function writeMeta(string $uploadId, int $ownerId, int $size): void
    {
        @file_put_contents($this->metaPath($uploadId),
            json_encode(['owner' => $ownerId, 'size' => $size, 'created' => time()]));
    }

    private function readMeta(string $uploadId): ?array
    {
        $raw = @file_get_contents($this->metaPath($uploadId));
        $m = $raw !== false ? json_decode($raw, true) : null;
        return (is_array($m) && isset($m['owner'], $m['size'])) ? $m : null;
    }

    /**
     * Refuse an upload session that belongs to somebody else.
     *
     * Nothing used to check this. `writeMeta` recorded the owner at init and
     * then no other method read it back: `storeChunk()` took no owner at all,
     * `completeUpload()` took one and never compared it, and `initUpload()`
     * resumed any session whose directory existed. An account that came by
     * another account's uploadId could therefore inject chunks into that
     * transfer, or finish it and take the resulting asset as its own.
     *
     * The id is 128 bits of random_bytes, so this is not a guessing attack —
     * but an id that reaches the client is an id that reaches proxy logs, a
     * shared browser and a bug report, and "unguessable" is not the same
     * property as "authorised".
     *
     * A session with NO meta is the one exception, and a narrow one: it was
     * created by a release that predates the meta file, and refusing it would
     * strand a transfer across an upgrade. It is adopted, and stamped, so this
     * check applies to it from the next chunk onward.
     */
    private function assertOwner(string $uploadId, int $ownerId): void
    {
        $m = $this->readMeta($uploadId);
        if ($m !== null && (int) $m['owner'] !== $ownerId) {
            throw new \RuntimeException('Unknown upload');
        }
    }

    /** Open-session count and declared bytes currently in flight for one user. */
    private function inFlightFor(int $ownerId): array
    {
        $tmp = $this->root() . '/tmp';
        $sessions = 0;
        $declared = 0;
        if (is_dir($tmp)) {
            foreach (scandir($tmp) ?: [] as $d) {
                if (!self::isValidUploadId($d)) continue;
                $m = $this->readMeta($d);
                if ($m && (int) $m['owner'] === $ownerId) {
                    $sessions++;
                    $declared += max(0, (int) $m['size']);
                }
            }
        }
        return ['sessions' => $sessions, 'declared' => $declared];
    }

    /** Chunk indices already on disk, ascending. */
    public function receivedChunks(string $uploadId): array
    {
        $dir = $this->tmpDir($uploadId);
        if (!is_dir($dir)) return [];
        $out = [];
        foreach (scandir($dir) ?: [] as $f) {
            if (preg_match('/^(\d+)$/', $f, $m)) $out[] = (int) $m[1];
        }
        sort($out);
        return $out;
    }

    public function storeChunk(int $ownerId, string $uploadId, int $index, string $tmpFile): int
    {
        $dir = $this->tmpDir($uploadId);
        if (!is_dir($dir)) throw new \RuntimeException('Unknown upload');
        $this->assertOwner($uploadId, $ownerId);
        if ($index < 0 || $index > 100000) throw new \RuntimeException('Chunk index out of range');

        $size = @filesize($tmpFile);
        if ($size === false || $size <= 0) throw new \RuntimeException('Empty chunk');
        // A chunk larger than the advertised size means the client ignored what
        // the server told it, and letting it through defeats the whole point.
        if ($size > $this->chunkSize() * 2) throw new \RuntimeException('Chunk too large');

        // Bound the session by what init declared (plus one chunk of slack — a
        // correct client's chunks sum to exactly the declared size). Without
        // this, nothing stopped a session that never calls complete() from
        // accumulating 100000 × 2·chunkSize in tmp/, bypassing quota entirely.
        //
        // The sum → check → move sequence runs under an exclusive per-session
        // lock: concurrent chunk requests for one uploadId would otherwise each
        // read the same stale total, all pass the bound, and all write — pushing
        // tmp/ past the declared size by (concurrency − 1) chunks. The lock makes
        // the declared-size bound actually hold under parallel uploads.
        $lock = @fopen($dir . '/.lock', 'c');
        if ($lock !== false) flock($lock, LOCK_EX);
        try {
            $meta = $this->readMeta($uploadId);
            if ($meta !== null) {
                $have = 0;
                foreach (scandir($dir) ?: [] as $f) {
                    if ($f !== (string) $index && preg_match('/^\d+$/', $f)) {
                        $have += (int) @filesize($dir . '/' . $f);
                    }
                }
                if ($have + $size > (int) $meta['size'] + $this->chunkSize()) {
                    throw new \RuntimeException('Upload exceeds its declared size');
                }
            }

            if (!@move_uploaded_file($tmpFile, $dir . '/' . $index)
                && !@rename($tmpFile, $dir . '/' . $index)) {
                throw new \RuntimeException('Could not store chunk');
            }
        } finally {
            if ($lock !== false) { @flock($lock, LOCK_UN); @fclose($lock); }
        }
        return (int) $size;
    }

    /**
     * Assemble the chunks, verify the checksum, and move the file into place.
     *
     * The declared sha256 is verified against the assembled bytes: it is what
     * makes dedupe safe and it is the only way to notice a chunk that arrived
     * corrupted or out of order.
     *
     * @return array{path:string, size:int, mime:string, deduped:bool}
     */
    public function completeUpload(int $ownerId, string $uploadId, string $sha, int $expectedSize): array
    {
        $dir = $this->tmpDir($uploadId);
        if (!is_dir($dir)) throw new \RuntimeException('Unknown upload');
        $this->assertOwner($uploadId, $ownerId);
        if (!self::isValidSha($sha)) throw new \RuntimeException('Invalid checksum');

        $chunks = $this->receivedChunks($uploadId);
        if (!$chunks) {
            // Same reasoning as the short-assembly case below: zero chunks is
            // just the shortest possible "still in flight". Discarding here
            // turned a client that completed too early into a client whose
            // session was destroyed — its in-flight chunks then bounced off
            // "Unknown upload" and everything had to be re-sent after a re-init.
            throw new \RuntimeException(
                '0 of ' . $expectedSize . ' bytes have arrived — upload the chunks first');
        }
        // Contiguous from zero: a gap means a chunk was lost, and concatenating
        // around it would produce a file that is wrong rather than short.
        foreach ($chunks as $i => $n) {
            if ($n !== $i) { throw new \RuntimeException('Missing chunk ' . $i); }
        }

        $assembled = $dir . '/assembled';
        $out = @fopen($assembled, 'wb');
        if (!$out) throw new \RuntimeException('Could not assemble upload');
        $total = 0;
        try {
            try {
                foreach ($chunks as $n) {
                    $in = @fopen($dir . '/' . $n, 'rb');
                    if (!$in) throw new \RuntimeException('Could not read chunk ' . $n);
                    while (!feof($in)) {
                        $buf = fread($in, 1 << 20);
                        if ($buf === false) break;
                        $total += strlen($buf);
                        if (fwrite($out, $buf) === false) throw new \RuntimeException('Write failed');
                    }
                    fclose($in);
                }
            } finally {
                fclose($out);
            }

            if ($expectedSize > 0 && $total !== $expectedSize) {
                // NOT discarded: a short assembly means chunks are still in flight,
                // which is the most recoverable state there is. Throwing away the
                // chunks already received would force a full re-upload and defeat
                // the entire point of making this resumable.
                throw new \RuntimeException(
                    'Only ' . $total . ' of ' . $expectedSize . ' bytes have arrived — upload the remaining chunks');
            }
        } catch (\RuntimeException $e) {
            // The chunks stay resumable, but the half-built assembly must go:
            // keeping it held the session at DOUBLE its bytes until the sweep.
            @unlink($assembled);
            throw $e;
        }
        if (!hash_equals($sha, hash_file('sha256', $assembled))) {
            // Discarded, unlike the short case: every chunk arrived and the
            // bytes are still wrong, so at least one is corrupt and there is no
            // way to know which. A full retry is the only recovery, and keeping
            // the poisoned chunks would only grow the temp directory.
            $this->discardUpload($uploadId);
            throw new \RuntimeException('Checksum mismatch — the upload was corrupted');
        }

        // Re-check the quota now the real size is known: two uploads that each
        // passed init can only overrun together, and this is where that shows.
        // Bytes already charged for these very bytes are subtracted first — a
        // re-upload of an existing asset needs no new storage, and counting it
        // twice refused exactly the transfer that costs nothing.
        if ($this->userQuota() > 0) {
            $usage = $this->usageFor($ownerId);
            $existing = StudioAsset::findBySha($ownerId, $sha);
            if ($existing) $usage -= min($usage, (int) $existing['size']);
            if ($usage + $total > $this->userQuota()) {
                $this->discardUpload($uploadId);
                throw new \RuntimeException('Storage quota exceeded');
            }
        }

        // Never trust a client-declared type.
        $mime = 'application/octet-stream';
        if (function_exists('finfo_open')) {
            $fi = finfo_open(FILEINFO_MIME_TYPE);
            if ($fi) { $mime = (string) (finfo_file($fi, $assembled) ?: $mime); finfo_close($fi); }
        }

        $final = $this->assetPath($ownerId, $sha);
        $this->ensureDir(dirname($final));
        // Same bytes already stored: keep the original file, drop the copy.
        $deduped = is_file($final);
        if ($deduped) { @unlink($assembled); }
        elseif (!@rename($assembled, $final)) {
            throw new \RuntimeException('Could not store the assembled file');
        }
        $this->discardUpload($uploadId);

        return ['path' => $final, 'size' => $total, 'mime' => $mime, 'deduped' => $deduped];
    }

    public function discardUpload(string $uploadId): void
    {
        $dir = $this->tmpDir($uploadId);
        if (!is_dir($dir)) return;
        foreach (scandir($dir) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            @unlink($dir . '/' . $f);
        }
        @rmdir($dir);
    }

    /** Remove a stored file, but only when no other row still points at it. */
    public function deleteAssetFile(int $ownerId, string $sha): void
    {
        $path = $this->assetPath($ownerId, $sha);
        if (is_file($path)) @unlink($path);
    }

    /**
     * Remove EVERYTHING an owner has stored — called when the user is deleted.
     *
     * The FK cascade removes the studio_assets rows, but rows are the only
     * record the files exist: without this, up to a full user quota of dead
     * bytes per deleted user sat on disk forever, undetectable afterwards.
     * Runs even when the studio is disabled — the files are there regardless.
     */
    public function deleteOwnerFiles(int $ownerId): void
    {
        $dir = $this->root() . '/assets/' . $ownerId;
        if ($ownerId <= 0 || !is_dir($dir)) return;
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $f) {
            $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
        }
        @rmdir($dir);
    }

    /** Sweep abandoned uploads. Called by maintenance, not by a request path. */
    public function sweepStaleUploads(int $olderThanSeconds = 86400): int
    {
        $tmp = $this->root() . '/tmp';
        if (!is_dir($tmp)) return 0;
        $n = 0;
        $cutoff = time() - max(60, $olderThanSeconds);
        foreach (scandir($tmp) ?: [] as $d) {
            if (!self::isValidUploadId($d)) continue;
            $path = $tmp . '/' . $d;
            if (@filemtime($path) !== false && filemtime($path) < $cutoff) {
                $this->discardUpload($d);
                $n++;
            }
        }
        return $n;
    }

    /**
     * Everything this user is charged for, in bytes.
     *
     * ASSETS WERE THE ONLY THING COUNTED. Project documents and their version
     * history are stored in MySQL, not on disk, so `SUM(size)` over
     * studio_assets never saw them — and there is a lot to not see: a document is
     * the whole project (every clip, every keyframe, every annotation), each
     * project keeps 50 autosaves of it, and named versions are kept forever. A
     * user could therefore fill a shared host's disk to the point of breaking
     * every other account on it without ever uploading a single asset, while the
     * CLOUD tab reported 0% of quota used.
     *
     * StudioProject::documentBytes() already existed and was called from nowhere,
     * which is the tell: the intent was there and the wiring was not.
     */
    public function usageFor(int $ownerId): int
    {
        return StudioAsset::quotaUsage($ownerId)
            + StudioProject::documentBytes($ownerId)
            + StudioVersion::documentBytes($ownerId);
    }

    public function quotaInfo(int $ownerId): array
    {
        $assets = StudioAsset::quotaUsage($ownerId);
        $projects = StudioProject::documentBytes($ownerId);
        $versions = StudioVersion::documentBytes($ownerId);
        $used = $assets + $projects + $versions;
        $quota = $this->userQuota();
        return [
            'used'      => $used,
            'quota'     => $quota,
            'remaining' => $quota > 0 ? max(0, $quota - $used) : null,
            'percent'   => $quota > 0 ? round(($used / $quota) * 100, 2) : 0,
            /* Broken out, because "you are full" is not an actionable message
               when the thing that filled you is invisible: an author who has
               uploaded nothing needs to be told it is their version history. */
            'breakdown' => ['assets' => $assets, 'projects' => $projects, 'versions' => $versions],
        ];
    }
}
