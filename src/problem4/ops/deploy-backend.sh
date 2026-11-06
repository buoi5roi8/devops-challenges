#!/usr/bin/env bash
set -euo pipefail

bucket=${1:?release bucket required}
sha=${2:?commit SHA required}
base=/opt/product
release="$base/releases/$sha"
archive=/tmp/backend-$sha.tgz

mkdir -p "$base/releases"
aws s3 cp "s3://$bucket/backend/$sha.tgz" "$archive" --no-progress
aws s3 cp "s3://$bucket/backend/$sha.tgz.sha256" "$archive.sha256" --no-progress
(cd /tmp && sha256sum -c "$(basename "$archive").sha256")
test ! -e "$release"
mkdir -p "$release"
tar -xzf "$archive" -C "$release"
ln -sfn "$release" "$base/current"
systemctl restart product-backend
for _ in {1..30}; do
  curl --fail --silent --show-error http://127.0.0.1:3000/healthz && exit 0
  sleep 2
done
exit 1
