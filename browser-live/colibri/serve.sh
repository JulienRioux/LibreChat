#!/bin/sh
# Serves a model through colibri (github.com/JustVugg/colibri) for LibreChat's `colibri` endpoint.
# README.md next to this file has the build, the import and the librechat.yaml entry.
#
#   ./serve.sh [model directory] [more coli serve options]
#
# COLIBRI is the colibri checkout (default ~/colibri). Refuses to start while Ollama has a model
# loaded: two large models at once exhaust a 24 GB Mac's memory and both servers fail.
set -e
COLIBRI=${COLIBRI:-$HOME/colibri}
MODEL=${1:-$HOME/models/Qwen3.6-35B-A3B-GGUF/Qwen3.6-35B-A3B-Q4_K_M.colibri}
[ $# -gt 0 ] && shift
if [ -n "$(ollama ps 2>/dev/null | tail -n +2)" ]; then
  echo "Ollama has a model loaded (ollama ps); stop it first." >&2
  exit 1
fi
cd "$COLIBRI/c"
# --allowed-host: colibri checks the Host header, and answers 403 to LibreChat's container
# (host.docker.internal) without it.
exec ./coli serve --model "$MODEL" \
  --host 127.0.0.1 --port 8000 --ctx 32768 \
  --model-id qwen3.6-35b-a3b-colibri \
  --allowed-host host.docker.internal \
  "$@"
