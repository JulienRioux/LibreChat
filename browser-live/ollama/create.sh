#!/bin/sh
# Builds a Qwen3 model for Ollama whose prompt template writes tool definitions as JSON.
#
# Ollama's stock Qwen3 template prints them as Go struct text (ollama/ollama#14601), and
# drops a tool call from the history when the same turn also has text. The templates here fix
# both. Sampling parameters are inherited from the base model.
#
#   ./create.sh <base model> <new name> [context tokens] [think]
#   ./create.sh qwen3:14b qwen3-32k-tools:14b 32768        thinking stays switchable by the client
#   ./create.sh qwen3:14b qwen3-32k-fast:14b 32768 off     thinking is off, whatever the client sends
set -e
BASE=${1:?base model, for example qwen3:14b}
NAME=${2:?name for the new model, for example qwen3-32k-tools:14b}
CTX=${3:-32768}
THINK=${4:-on}
DIR=$(cd "$(dirname "$0")" && pwd)
TEMPLATE="$DIR/qwen3.template"
if [ "$THINK" = "off" ]; then TEMPLATE="$DIR/qwen3-fast.template"; fi
FILE=$(mktemp)
trap 'rm -f "$FILE"' EXIT
{
  echo "FROM $BASE"
  printf 'TEMPLATE """'
  cat "$TEMPLATE"
  echo '"""'
  echo "PARAMETER num_ctx $CTX"
} > "$FILE"
ollama create "$NAME" -f "$FILE"
