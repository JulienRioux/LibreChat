#!/bin/sh
# Serves a model through colibri (github.com/JustVugg/colibri) for LibreChat's `colibri` endpoint.
# README.md next to this file has the build, the import and the librechat.yaml entry; use.sh
# switches the served model.
#
#   ./serve.sh [model directory] [more coli serve options]
#
# The model id LibreChat sees is the directory's name (MODEL_ID overrides it): colibri's own
# default names a family, so Qwen3.6, Qwen3-Coder and Flint would all be `qwen3.6-colibri`.
# COLIBRI is the colibri checkout (default ~/colibri). Refuses to start while Ollama has a model
# loaded: two large models at once exhaust a 24 GB Mac's memory and both servers fail.
set -e
COLIBRI=${COLIBRI:-$HOME/colibri}
MODEL=${1:-$HOME/models/colibri/qwen3.6-35b-a3b-colibri}
[ $# -gt 0 ] && shift
MODEL_ID=${MODEL_ID:-$(basename "$MODEL")}
if [ -n "$(ollama ps 2>/dev/null | tail -n +2)" ]; then
  echo "Ollama has a model loaded (ollama ps); stop it first." >&2
  exit 1
fi
cd "$COLIBRI/c"
# --allowed-host: colibri checks the Host header, and answers 403 to LibreChat's container
# (host.docker.internal) without it.
exec ./coli serve --model "$MODEL" \
  --host 127.0.0.1 --port 8000 --ctx 32768 \
  --model-id "$MODEL_ID" \
  --allowed-host host.docker.internal \
  "$@"
