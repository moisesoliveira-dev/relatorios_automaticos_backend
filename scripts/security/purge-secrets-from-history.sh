#!/usr/bin/env bash
# Remove credenciais do histórico Git (backend).
# ATENÇÃO: exige force push e ROTAÇÃO de todas as credenciais expostas.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=== Purge de secrets no histórico Git ==="
echo "Repo: $REPO_ROOT"
echo ""
echo "Pré-requisitos:"
echo "  1. git-filter-repo instalado (~/.local/bin/git-filter-repo)"
echo "  2. Working tree limpo (commit ou stash das mudanças locais)"
echo "  3. Credenciais JÁ ROTACIONADAS (Pontta, GOSAC, SMTP, Railway)"
echo ""

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "Instale: python3 -m pip install --break-system-packages git-filter-repo"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERRO: há mudanças não commitadas. Faça commit ou git stash antes."
  git status --short
  exit 1
fi

REPLACEMENTS="$REPO_ROOT/scripts/security/replacements.txt"
if [[ ! -f "$REPLACEMENTS" ]]; then
  echo "ERRO: $REPLACEMENTS não encontrado"
  exit 1
fi

echo "Isso reescreve TODO o histórico local. Um backup será criado em ../relatorios_automaticos_backend.git-backup"
read -r -p "Continuar? (digite SIM): " confirm
if [[ "$confirm" != "SIM" ]]; then
  echo "Cancelado."
  exit 0
fi

BACKUP="../relatorios_automaticos_backend.git-backup-$(date +%Y%m%d-%H%M%S)"
git clone --mirror . "$BACKUP"
echo "Backup: $BACKUP"

git filter-repo --force \
  --replace-text "$REPLACEMENTS" \
  --path-glob '.env' --invert-paths \
  --path-glob '.env.development' --invert-paths \
  --path-glob '.env.production' --invert-paths

echo ""
echo "Histórico local reescrito."
echo ""
echo "Próximo passo (CUIDADO — sobrescreve o remoto):"
echo "  git push origin main --force"
echo ""
echo "Depois do push:"
echo "  - Peça a colaboradores para clonar de novo (git clone)"
echo "  - Revogue credenciais antigas em Pontta, GOSAC, Gmail, Railway"
echo "  - Configure novas vars no Railway (nunca no .env.example)"
