#!/usr/bin/env bash
# Suíte de regressão do RH Survey. Uso, a partir de backend/:  bash tests/run.sh
set -u
rm -f test.db test.db-wal test.db-shm
SQLITE_PATH=./test.db node src/utils/seed.js >/dev/null 2>&1 || { echo "seed falhou"; exit 1; }
fail=0
for f in tests/fase1.js tests/fase2.js tests/fase3.js tests/smoke.js; do
  echo "═══ $f ═══"
  out=$(node "$f" 2>&1 | grep -vE "Experimental|trace-warnings|ExperimentalWarning|info\b|\[32m")
  echo "$out"
  # Falhou se algum teste marcou FALHA ou se o total de falhas é maior que zero.
  echo "$out" | grep -qE "^ FALHA" && fail=1
  echo "$out" | grep -qE "·[[:space:]]*[1-9][0-9]*[[:space:]]+falhou" && fail=1
  echo "$out" | grep -qE "^ERRO" && fail=1
done
rm -f test.db test.db-wal test.db-shm
echo
if [ $fail -eq 0 ]; then echo "REGRESSÃO OK"; else echo "REGRESSÃO COM FALHAS"; fi
exit $fail
