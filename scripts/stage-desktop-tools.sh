#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vendor="${repo}/desktop/vendor"
case "${vendor}" in "${repo}/desktop/"*) ;; *) echo "Unsafe vendor path" >&2; exit 1;; esac
rm -rf -- "${vendor}"
mkdir -p "${vendor}/postgres/bin"

for tool in pg_dump pg_dumpall psql; do
  command -v "${tool}" >/dev/null || { echo "Missing ${tool}. Install PostgreSQL client tools first." >&2; exit 1; }
done
pg_bin="$(dirname "$(command -v pg_dump)")"
for tool in pg_dump pg_dumpall psql; do cp "${pg_bin}/${tool}" "${vendor}/postgres/bin/${tool}"; done

pg_prefix="$(cd "${pg_bin}/.." && pwd)"
mkdir -p "${vendor}/postgres/lib"
case "$(uname -s)" in
  Linux)
    command -v ldd >/dev/null || { echo "Missing ldd; cannot stage PostgreSQL runtime libraries." >&2; exit 1; }
    {
      for tool in pg_dump pg_dumpall psql; do
        ldd "${pg_bin}/${tool}" 2>/dev/null || true
      done
    } | awk '/=> \/[^ ]+/ { print $3 } /^\/[^ ]+/ { print $1 }' | sort -u | while IFS= read -r library; do
      [[ -f "${library}" ]] && cp -L "${library}" "${vendor}/postgres/lib/$(basename "${library}")"
    done
    ;;
  Darwin)
    # Homebrew PostgreSQL clients normally keep their non-system dylibs together.
    # Dereference links so the package never contains a path back to the build Mac.
    if [[ -d "${pg_prefix}/lib" ]]; then
      find "${pg_prefix}/lib" -maxdepth 1 \( -type f -o -type l \) -name '*.dylib' -exec sh -c 'for library do cp -L "$library" "$1/$(basename "$library")"; done' sh "${vendor}/postgres/lib" {} +
    fi
    ;;
esac
for notice in commandlinetools_3rd_party_licenses.txt server_license.txt COPYRIGHT; do
  [[ -f "${pg_prefix}/${notice}" ]] && cp "${pg_prefix}/${notice}" "${vendor}/postgres/${notice}"
done

supabase_bin="$(find "${repo}/node_modules/@supabase" -type f -name supabase -perm -u+x -print -quit 2>/dev/null || true)"
[[ -n "${supabase_bin}" ]] || { echo "Pinned Supabase CLI binary not found. Run npm install on this platform." >&2; exit 1; }
cp "${supabase_bin}" "${vendor}/supabase"
chmod 755 "${vendor}/supabase"

echo "Staged PostgreSQL tools from ${pg_bin} and the pinned Supabase CLI."
