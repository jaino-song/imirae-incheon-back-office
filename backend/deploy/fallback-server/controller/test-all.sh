#!/usr/bin/env bash

set -euo pipefail

readonly CONTROLLER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly FALLBACK_ROOT="$(cd "$CONTROLLER_ROOT/.." && pwd -P)"
readonly CONTRACT_TEST="$CONTROLLER_ROOT/contract.test.sh"
readonly IDENTITY_TEST="$FALLBACK_ROOT/production-db-identity.test.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

require_file() {
    local file="$1"
    [[ -f "$file" && ! -L "$file" ]] || fail "missing required controller test artifact: ${file#$FALLBACK_ROOT/}"
}

require_file "$CONTRACT_TEST"
require_file "$IDENTITY_TEST"

runtime_files=()
while IFS= read -r -d '' file; do
    runtime_files+=("$file")
done < <(find "$CONTROLLER_ROOT" -type f -name '*.mjs' ! -name '*.test.mjs' -print0 | sort -z)

[[ "${#runtime_files[@]}" -gt 0 ]] || fail 'no controller runtime mjs files found'
for runtime_file in "${runtime_files[@]}"; do
    node --check "$runtime_file"
done

test_files=()
while IFS= read -r -d '' file; do
    test_files+=("$file")
done < <(
    {
        find "$CONTROLLER_ROOT" -maxdepth 1 -type f -name '*.test.mjs' -print
        find "$CONTROLLER_ROOT/test" -maxdepth 1 -type f -name '*.test.mjs' -print
    } | sort -u | tr '\n' '\0'
)

[[ "${#test_files[@]}" -gt 0 ]] || fail 'no controller Node test files found'
for test_file in "${test_files[@]}"; do
    node --test "$test_file"
done

bash "$CONTRACT_TEST"
bash "$IDENTITY_TEST"

echo 'Fallback Server controller test-all passed'
