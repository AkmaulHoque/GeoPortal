#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOMCAT_VERSION="${TOMCAT_VERSION:-9.0.121}"
mkdir -p "$ROOT/runtime"
rm -rf "$ROOT/runtime/tomcat" "$ROOT/runtime/java"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
TAR="apache-tomcat-${TOMCAT_VERSION}.tar.gz"
URL="https://dlcdn.apache.org/tomcat/tomcat-9/v${TOMCAT_VERSION}/bin/${TAR}"
echo "Downloading Tomcat ${TOMCAT_VERSION}..."
curl -fsSL "$URL" -o "$TMP/$TAR"
curl -fsSL "$URL.sha512" -o "$TMP/$TAR.sha512"
(cd "$TMP" && shasum -a 512 -c "$TAR.sha512")
tar -xzf "$TMP/$TAR" -C "$TMP"
mv "$TMP/apache-tomcat-${TOMCAT_VERSION}" "$ROOT/runtime/tomcat"
rm -rf "$ROOT/runtime/tomcat/webapps"/* "$ROOT/runtime/tomcat/logs"/* "$ROOT/runtime/tomcat/temp"/* "$ROOT/runtime/tomcat/work"/* || true

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/jlink" ]]; then
  echo "JAVA_HOME must point to JDK 17+ with jlink." >&2
  exit 2
fi
"$JAVA_HOME/bin/jlink" \
  --add-modules java.se,jdk.unsupported,jdk.crypto.ec \
  --strip-debug --no-header-files --no-man-pages --compress=2 \
  --output "$ROOT/runtime/java"

echo "Prepared Tomcat + Java runtime. GIS runtime is prepared separately by CI with conda-pack."
