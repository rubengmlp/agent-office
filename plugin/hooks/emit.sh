#!/bin/sh
exec sh "$(dirname "$0")/office-hook.sh" "${1:-events}"
