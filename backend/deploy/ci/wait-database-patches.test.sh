#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/wait-database-patches.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

bash -n "$SCRIPT" || fail "wait-database-patches.sh must be syntactically valid bash"
[[ -x "$SCRIPT" ]] || fail "wait-database-patches.sh must be executable"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

FAKE_GH="$TMP_ROOT/gh"
STATE_DIR="$TMP_ROOT/state"
mkdir -p "$STATE_DIR"

# A fake `gh` CLI, driven entirely by environment variables and a per-run
# call-counter state file, so each test scenario below can script exactly
# what the real GitHub API/CLI would have returned across successive polls.
cat >"$FAKE_GH" <<'FAKE_GH_EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${FAKE_GH_STATE_DIR:?FAKE_GH_STATE_DIR is required}"

cmd="${1:-}"; shift || true

case "$cmd" in
    api)
        endpoint="${1:-}"; shift || true
        case "$endpoint" in
            */compare/*)
                [[ "${COMPARE_FAIL:-0}" == 1 ]] && exit 1
                if [[ -n "${CHANGED_FILES:-}" ]]; then
                    printf '%s\n' "${CHANGED_FILES}"
                fi
                ;;
            */actions/workflows/database-patches.yml/runs\?*)
                [[ "${PRIMARY_FAIL:-0}" == 1 ]] && exit 1
                if [[ -n "${RUNS_PRIMARY:-}" ]]; then
                    printf '%s\n' "${RUNS_PRIMARY}"
                fi
                ;;
            */actions/runs/*)
                id="${endpoint##*/actions/runs/}"
                counter_file="$state_dir/calls_$id"
                count=0
                [[ -f "$counter_file" ]] && count="$(cat "$counter_file")"
                count=$((count + 1))
                echo "$count" >"$counter_file"
                seq_var="RUN_STATUS_SEQUENCE_$id"
                seq="${!seq_var:-completed:success}"
                IFS='|' read -r -a stages <<<"$seq"
                idx=$((count - 1))
                if (( idx >= ${#stages[@]} )); then
                    idx=$((${#stages[@]} - 1))
                fi
                stage="${stages[$idx]}"
                printf '%s %s\n' "${stage%%:*}" "${stage#*:}"
                ;;
            *)
                echo "fake gh: unhandled api endpoint: $endpoint" >&2
                exit 2
                ;;
        esac
        ;;
    run)
        sub="${1:-}"; shift || true
        case "$sub" in
            list)
                [[ "${FALLBACK_FAIL:-0}" == 1 ]] && exit 1
                if [[ -n "${RUNS_FALLBACK:-}" ]]; then
                    printf '%s\n' "${RUNS_FALLBACK}"
                fi
                ;;
            *)
                echo "fake gh: unhandled run subcommand: $sub" >&2
                exit 2
                ;;
        esac
        ;;
    *)
        echo "fake gh: unhandled command: $cmd" >&2
        exit 2
        ;;
esac
FAKE_GH_EOF
chmod 700 "$FAKE_GH"

ZERO_SHA="0000000000000000000000000000000000000000"
BEFORE_SHA_FIXTURE="1111111111111111111111111111111111111111"
HEAD_SHA_FIXTURE="2222222222222222222222222222222222222222"

run_script() {
    local calls_dir
    calls_dir="$(mktemp -d "$STATE_DIR/calls.XXXXXX")"
    env \
        GH_BIN="$FAKE_GH" \
        FAKE_GH_STATE_DIR="$calls_dir" \
        GH_TOKEN=fake-token \
        GITHUB_REPOSITORY="acme/widgets" \
        HEAD_SHA="$HEAD_SHA_FIXTURE" \
        REF_NAME="main" \
        BEFORE_SHA="${BEFORE_SHA:-$BEFORE_SHA_FIXTURE}" \
        POLL_SECONDS="${POLL_SECONDS:-0}" \
        APPEAR_TIMEOUT_SECONDS="${APPEAR_TIMEOUT_SECONDS:-0}" \
        COMPLETE_TIMEOUT_SECONDS="${COMPLETE_TIMEOUT_SECONDS:-3600}" \
        CHANGED_FILES="${CHANGED_FILES:-}" \
        COMPARE_FAIL="${COMPARE_FAIL:-0}" \
        RUNS_PRIMARY="${RUNS_PRIMARY:-}" \
        PRIMARY_FAIL="${PRIMARY_FAIL:-0}" \
        RUNS_FALLBACK="${RUNS_FALLBACK:-}" \
        FALLBACK_FAIL="${FALLBACK_FAIL:-0}" \
        bash "$SCRIPT"
}

reset_scenario_env() {
    unset BEFORE_SHA POLL_SECONDS APPEAR_TIMEOUT_SECONDS COMPLETE_TIMEOUT_SECONDS
    unset CHANGED_FILES COMPARE_FAIL RUNS_PRIMARY PRIMARY_FAIL RUNS_FALLBACK FALLBACK_FAIL
    for name in $(compgen -v | grep '^RUN_STATUS_SEQUENCE_' || true); do
        unset "$name"
    done
}

# --- Scenario 1: no run + expected=no -> exit 0 fast, no prisma changes. ---
reset_scenario_env
CHANGED_FILES=$'backend/src/foo.ts\nREADME.md'
RUNS_PRIMARY=""
RUNS_FALLBACK=""
out="$(run_script)" || fail "scenario 1: expected exit 0 (no run expected) but the script failed: $out"
grep -Fq "No Database Patches run for $HEAD_SHA_FIXTURE" <<<"$out" \
    || fail "scenario 1: expected the no-run-expected message, got: $out"

# --- Scenario 2: no run + expected=yes -> exit 1 after the appear timeout. ---
reset_scenario_env
CHANGED_FILES=$'backend/prisma/migrations/20260903_x/migration.sql'
RUNS_PRIMARY=""
RUNS_FALLBACK=""
APPEAR_TIMEOUT_SECONDS=0
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 2: expected exit 1 when a required run never appears, got exit $status: $out"
grep -Fq '::error::' <<<"$out" || fail "scenario 2: expected an ::error:: annotation, got: $out"

# --- Scenario 3: run in_progress then success across two polls -> exit 0. ---
reset_scenario_env
RUNS_PRIMARY="101 in_progress -"
export RUN_STATUS_SEQUENCE_101="in_progress:-|completed:success"
out="$(run_script)" || fail "scenario 3: expected exit 0 once the run completes successfully: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 3: expected the success message, got: $out"

# --- Scenario 4: run completed with failure -> exit 1. ---
reset_scenario_env
RUNS_PRIMARY="102 completed failure"
export RUN_STATUS_SEQUENCE_102="completed:failure"
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 4: expected exit 1 for a failed run, got exit $status: $out"
grep -Fq '::error::Database Patches run 102 concluded failure' <<<"$out" \
    || fail "scenario 4: expected a concluded-failure error message, got: $out"

# --- Scenario 5: primary lookup empty, fallback finds the run -> waits on it. ---
reset_scenario_env
RUNS_PRIMARY=""
RUNS_FALLBACK="103 completed success"
export RUN_STATUS_SEQUENCE_103="completed:success"
out="$(run_script)" || fail "scenario 5: expected exit 0 once the fallback-found run succeeds: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 5: expected the success message from the fallback-found run, got: $out"

# --- Scenario 6: unknown BEFORE_SHA (zeros) + no run -> exit 0 with a warning. ---
reset_scenario_env
BEFORE_SHA="$ZERO_SHA"
RUNS_PRIMARY=""
RUNS_FALLBACK=""
APPEAR_TIMEOUT_SECONDS=0
out="$(run_script)" || fail "scenario 6: expected exit 0 when BEFORE_SHA is unknown and no run appears: $out"
grep -Fq '::warning::' <<<"$out" \
    || fail "scenario 6: expected a ::warning:: annotation, got: $out"

echo "wait-database-patches unit tests passed"
