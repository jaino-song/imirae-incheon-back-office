#!/usr/bin/env bash

# Waits for the "Database Patches" workflow run of the same commit before the
# caller proceeds (typically before resolving/deploying the backend). This
# closes the ordering gap that let PR #616 (2026-09-03) deploy code that read
# columns/tables a still-pending patch run had not yet created.
#
# Inputs (env):
#   GH_TOKEN                    GitHub token used by the `gh` CLI (consumed
#                                by `gh` itself; not read directly here).
#   GITHUB_REPOSITORY           "<owner>/<repo>"                     (required)
#   HEAD_SHA                    commit SHA being gated                (required)
#   REF_NAME                    branch name (fallback lookup)         (required)
#   BEFORE_SHA                  github.event.before; may be all zeros (required)
#   POLL_SECONDS                seconds between polls               (default 30)
#   APPEAR_TIMEOUT_SECONDS      seconds to wait for a run to appear (default 600)
#   COMPLETE_TIMEOUT_SECONDS    seconds to wait for the run to finish (default 7200)
#   GH_BIN                      `gh` binary to invoke (default "gh"; override in tests)

set -euo pipefail

readonly GH_BIN="${GH_BIN:-gh}"
readonly POLL_SECONDS="${POLL_SECONDS:-30}"
readonly APPEAR_TIMEOUT_SECONDS="${APPEAR_TIMEOUT_SECONDS:-600}"
readonly COMPLETE_TIMEOUT_SECONDS="${COMPLETE_TIMEOUT_SECONDS:-7200}"

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"
: "${REF_NAME:?REF_NAME is required}"
: "${BEFORE_SHA:?BEFORE_SHA is required}"

error() {
    echo "::error::$*" >&2
}

warning() {
    echo "::warning::$*"
}

run_url() {
    printf 'https://github.com/%s/actions/runs/%s' "$GITHUB_REPOSITORY" "$1"
}

is_zero_sha() {
    [[ "$1" =~ ^0+$ ]]
}

# Prints "yes", "no", or "unknown" — whether a Database Patches run is
# expected for this push, based on which files changed since BEFORE_SHA.
determine_expected() {
    if is_zero_sha "$BEFORE_SHA"; then
        echo unknown
        return
    fi

    local changed_files
    if ! changed_files="$("$GH_BIN" api \
        "repos/$GITHUB_REPOSITORY/compare/$BEFORE_SHA...$HEAD_SHA" \
        --paginate --jq '.files[].filename' 2>/dev/null)"; then
        echo unknown
        return
    fi

    if grep -Eq '^backend/prisma/|^\.github/workflows/database-patches\.yml$' <<<"$changed_files"; then
        echo yes
    else
        echo no
    fi
}

# Prints zero or more lines "<id> <status> <conclusion>" for HEAD_SHA.
lookup_runs() {
    local out
    out="$("$GH_BIN" api \
        "repos/$GITHUB_REPOSITORY/actions/workflows/database-patches.yml/runs?head_sha=$HEAD_SHA&event=push&per_page=20" \
        --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion // "-")"' 2>/dev/null || true)"

    if [[ -z "$out" ]]; then
        out="$("$GH_BIN" run list --repo "$GITHUB_REPOSITORY" --workflow "Database Patches" \
            --branch "$REF_NAME" --event push --limit 30 \
            --json databaseId,headSha,status,conclusion \
            --jq '.[] | select(.headSha=="'"$HEAD_SHA"'") | "\(.databaseId) \(.status) \(.conclusion // "-")"' \
            2>/dev/null || true)"
    fi

    printf '%s' "$out"
}

# Prints "<status> <conclusion>" for one run id.
refresh_run_status() {
    local id="$1"
    "$GH_BIN" api "repos/$GITHUB_REPOSITORY/actions/runs/$id" \
        --jq '"\(.status) \(.conclusion // "-")"'
}

# Polls until every run in $1 (lines "<id> <status> <conclusion>") reaches
# status "completed", then exits 0 if all concluded "success", else exits 1.
wait_for_runs_to_complete() {
    local runs_output="$1"
    local -a ids=()
    local id status conclusion line entry

    while read -r id status conclusion; do
        [[ -n "$id" ]] && ids+=("$id")
    done <<<"$runs_output"

    local elapsed=0
    local -a final_statuses=()
    while true; do
        final_statuses=()
        local all_complete=true
        local -a urls=()

        for id in "${ids[@]}"; do
            line="$(refresh_run_status "$id")"
            status="${line%% *}"
            conclusion="${line#* }"
            final_statuses+=("$id $status $conclusion")
            urls+=("$(run_url "$id")")
            if [[ "$status" != completed ]]; then
                all_complete=false
            fi
        done

        if [[ "$all_complete" == true ]]; then
            break
        fi

        if [[ "$elapsed" -ge "$COMPLETE_TIMEOUT_SECONDS" ]]; then
            for entry in "${final_statuses[@]}"; do
                read -r id status conclusion <<<"$entry"
                if [[ "$status" != completed ]]; then
                    error "Database Patches run $id timed out waiting; fix or approve it, then re-run the failed jobs of this workflow."
                fi
            done
            exit 1
        fi

        echo "Waiting for Database Patches run(s) to complete: ${urls[*]}"
        sleep "$POLL_SECONDS"
        elapsed=$((elapsed + POLL_SECONDS))
    done

    local -a failed=()
    for entry in "${final_statuses[@]}"; do
        read -r id status conclusion <<<"$entry"
        if [[ "$conclusion" != success ]]; then
            failed+=("$entry")
        fi
    done

    if [[ "${#failed[@]}" -gt 0 ]]; then
        for entry in "${failed[@]}"; do
            read -r id status conclusion <<<"$entry"
            error "Database Patches run $id concluded $conclusion; fix or approve it, then re-run the failed jobs of this workflow."
        done
        exit 1
    fi

    echo "Database Patches run(s) succeeded for $HEAD_SHA."
}

main() {
    local expected
    expected="$(determine_expected)"

    local runs_output
    runs_output="$(lookup_runs)"

    if [[ -z "$runs_output" ]]; then
        if [[ "$expected" == no ]]; then
            echo "No Database Patches run for $HEAD_SHA (no prisma changes); proceeding."
            exit 0
        fi

        local elapsed=0
        while [[ -z "$runs_output" && "$elapsed" -lt "$APPEAR_TIMEOUT_SECONDS" ]]; do
            sleep "$POLL_SECONDS"
            elapsed=$((elapsed + POLL_SECONDS))
            runs_output="$(lookup_runs)"
        done

        if [[ -z "$runs_output" ]]; then
            if [[ "$expected" == unknown ]]; then
                warning "No Database Patches run found for $HEAD_SHA within ${APPEAR_TIMEOUT_SECONDS}s, and changed files could not be determined (comparing against BEFORE_SHA=$BEFORE_SHA failed or is unset). Proceeding without confirmation."
                exit 0
            fi

            error "A Database Patches run is required for $HEAD_SHA (backend/prisma changes detected) but none appeared within ${APPEAR_TIMEOUT_SECONDS}s."
            exit 1
        fi
    fi

    wait_for_runs_to_complete "$runs_output"
}

main "$@"
