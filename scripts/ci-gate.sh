#!/usr/bin/env bash
#
# Dead Signal Studio — the whole gate.
#
#   bash scripts/ci-gate.sh              run every suite that can run here
#   bash scripts/ci-gate.sh --headless   skip the four Chromium suites
#   bash scripts/ci-gate.sh --no-skip    a skipped gate fails the run (use in CI)
#   bash scripts/ci-gate.sh --list       print the gates and exit
#
# Ten suites. Four of them drive Chromium through Playwright and SKIP — loudly,
# but without failing — when Playwright is not installed, because "no browser
# on this machine" is not a defect in the studio. Everything else is
# dependency-free Node and PHP, so a bare checkout can still prove most of
# itself.
#
# A skipped gate is reported as SKIP and does not turn the run red. A gate that
# runs and fails does, and the script keeps going so one failure does not hide
# the other nine.
#
# The two suites that need a live server and a MySQL database (test-studio-api.php
# and test-studio-cloud.mjs) are deliberately NOT here — see the README.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE" || exit 1

HEADLESS_ONLY=0
LIST_ONLY=0
NO_SKIP=0
for arg in "$@"; do
    case "$arg" in
        --headless) HEADLESS_ONLY=1 ;;
        --no-skip)  NO_SKIP=1 ;;
        --list)     LIST_ONLY=1 ;;
        -h|--help)  sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)          echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

if [ "$HEADLESS_ONLY" -eq 1 ] && [ "$NO_SKIP" -eq 1 ]; then
    echo "--headless and --no-skip contradict each other: one skips gates, the other forbids it." >&2
    exit 2
fi

# Playwright is resolved the same way the suites resolve it: the local
# node_modules first, then a global install. Export NODE_PATH so `import
# 'playwright'` finds a global one without every suite repeating the fallback.
if [ -z "${NODE_PATH:-}" ]; then
    for candidate in /opt/node22/lib/node_modules /usr/lib/node_modules /usr/local/lib/node_modules; do
        [ -d "$candidate/playwright" ] && export NODE_PATH="$candidate" && break
    done
fi

PASSED=0; FAILED=0; SKIPPED=0
FAILED_NAMES=()

# report <name> <runner> <file> [browser]
#   A gate marked `browser` is skipped wholesale under --headless.
report() {
    local name="$1" runner="$2" file="$3" kind="${4:-headless}"

    if [ "$kind" = "browser" ] && [ "$HEADLESS_ONLY" -eq 1 ]; then
        printf '  SKIP  %-46s (--headless)\n' "$name"
        SKIPPED=$((SKIPPED + 1)); return 0
    fi
    if [ ! -f "$file" ]; then
        printf '  FAIL  %-46s (missing: %s)\n' "$name" "$file"
        FAILED=$((FAILED + 1)); FAILED_NAMES+=("$name"); return 0
    fi

    local out status
    out="$("$runner" "$file" 2>&1)"; status=$?

    # A browser suite that cannot find Playwright says so and exits 0. Surface
    # that as SKIP rather than a green PASS it did not earn — and under
    # --no-skip, as the failure it is: a CI run that silently skipped four of
    # ten suites would report green having tested almost nothing.
    if [ "$kind" = "browser" ] && printf '%s' "$out" | grep -qi 'playwright not installed'; then
        if [ "$NO_SKIP" -eq 1 ]; then
            printf '  FAIL  %-46s (playwright not installed, and --no-skip)\n' "$name"
            FAILED=$((FAILED + 1)); FAILED_NAMES+=("$name"); return 0
        fi
        printf '  SKIP  %-46s (playwright not installed)\n' "$name"
        SKIPPED=$((SKIPPED + 1)); return 0
    fi

    if [ "$status" -eq 0 ]; then
        printf '  PASS  %-46s %s\n' "$name" "$(printf '%s' "$out" | grep -Eio '[0-9]+ passed[^,]*' | tail -1)"
        PASSED=$((PASSED + 1))
    else
        printf '  FAIL  %-46s (exit %d)\n' "$name" "$status"
        printf '%s\n' "$out" | tail -30 | sed 's/^/        | /'
        FAILED=$((FAILED + 1)); FAILED_NAMES+=("$name")
    fi
}

if [ "$LIST_ONLY" -eq 1 ]; then
    # Anchored at column 0 so this line cannot match itself.
    grep -oE '^report "media studio[^"]*"[[:space:]]+[a-z]+[[:space:]]+[^[:space:]]+' "${BASH_SOURCE[0]}" \
        | sed -E 's/^report "([^"]*)"[[:space:]]+[a-z]+[[:space:]]+/  \1 → /'
    exit 0
fi

echo "=========================================================="
echo "Dead Signal Studio — CI gate"
echo "  node $(node --version 2>/dev/null || echo 'MISSING')  ·  php $(php -r 'echo PHP_VERSION;' 2>/dev/null || echo 'MISSING')"
echo "=========================================================="

report "media studio · gif encoder"        node test-gif-encoder.mjs
report "media studio · determinism"        node test-studio-rng.mjs
report "media studio · module graph"       node test-studio-modules.mjs
report "media studio · project document"   node test-studio-document.mjs
report "media studio · api discovery"      node test-studio-deploy.mjs
report "media studio · backend units"      php  test-studio-units.php
report "media studio · accessibility"      node test-studio-a11y.mjs     browser
report "media studio · behaviour audit"    node test-studio-audit.mjs    browser
report "media studio · smoke"              node test-studio-smoke.mjs    browser
report "media studio · deep audit"         node test-studio-deep.mjs     browser

echo "----------------------------------------------------------"
printf 'gate: %d passed, %d failed, %d skipped\n' "$PASSED" "$FAILED" "$SKIPPED"
if [ "$FAILED" -gt 0 ]; then
    printf 'failing: %s\n' "${FAILED_NAMES[*]}"
    exit 1
fi
echo "gate: green"
