#!/bin/bash

set -euo pipefail

die() {
    echo "The legacy preview operator is retired; use the root-only babyjamjam-ci-operator." >&2
    exit 1
}

main() {
    die
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
