#!/usr/bin/env bash
# Suíte de regressão do RH Survey. Uso: bash tests/run.sh (a partir de backend/)
set -u
rm -f test.db test.db-wal test.db-shm
SQLITE_PATH=./test.db node src/utils/seed.js >/dev/null 2>&1 || { echo "seed falhou"; exit 1; }
fail=0
for f in tests/fase1.js tests/fase2.js tests/smoke.js; do
  echo "═══ $f ═══"
  node "$f" 2>&1 | grep -vE "Experimental|trace-warnings|ExperimentalWarning|info\b|\[32m"
  node "$f" 2>&1 | grep -qiE "falhou: *[1-9]|FALHA" && fail=1
done
rm -f test.db test.db-wal test.db-shm
echo; [ $fail -eq 0 ] && echo "REGRESSÃO OK" || echo "REGRESSÃO COM FALHAS"
exit $fail
