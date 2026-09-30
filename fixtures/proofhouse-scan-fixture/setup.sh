#!/usr/bin/env bash
# Creates the fixture as a standalone git repo, including a leaked-then-deleted
# secret in git history (so GitLeaks full-history scanning has something to find).
#
# Usage:
#   ./setup.sh                      # init the repo locally in ./repo
#   cd repo && gh repo create <you>/proofhouse-scan-fixture --private --source=. --push
set -euo pipefail

cd "$(dirname "$0")"
rm -rf repo
mkdir repo
cp -R package.json Dockerfile main.tf src test repo/
cd repo

git init -q
git add .
git commit -qm "initial fixture app"

# Commit a fake AWS credential (AWS's documented example key pair), then delete
# it — the secret lives on in history, which is what gitleaks should catch.
mkdir -p config
cat > config/credentials.txt <<'EOF'
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
EOF
git add config/credentials.txt
git commit -qm "add deployment credentials (oops)"
git rm -q config/credentials.txt
git commit -qm "remove credentials file"

echo "Fixture repo ready in $(pwd)"
echo "Push it with: gh repo create <you>/proofhouse-scan-fixture --private --source=. --push"
