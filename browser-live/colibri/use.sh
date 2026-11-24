#!/bin/sh
# Lists the models colibri can serve, or switches the one it serves on port 8000.
#
#   ./use.sh          the models in $COLIBRI_MODELS, the running one marked
#   ./use.sh <id>     stop the running server, serve <id>, and wait until it answers
#
# Each entry of COLIBRI_MODELS (default ~/models/colibri) is a model directory, or a link to one,
# named after the model id LibreChat sees. To add one:
#   coli import --mode link --out ~/models/colibri/<id> <file>.gguf
# Only one model is served at a time: two large models at once exhaust the Mac's memory.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
COLIBRI=${COLIBRI:-$HOME/colibri}
MODELS=${COLIBRI_MODELS:-$HOME/models/colibri}
LOG=${COLIBRI_LOG:-$COLIBRI/.serve.log}
API=http://127.0.0.1:8000/v1/models

running() {
  curl -s -m 3 "$API" 2>/dev/null | sed -n 's/^{"object":"list","data":\[{"id":"\([^"]*\)".*/\1/p'
}

if [ $# -eq 0 ]; then
  now=$(running)
  for dir in "$MODELS"/*; do
    [ -d "$dir" ] || continue
    id=$(basename "$dir")
    if [ "$id" = "$now" ]; then echo "* $id (running)"; else echo "  $id"; fi
  done
  [ -n "$now" ] || echo "(no colibri server on port 8000)"
  exit 0
fi

ID=$1
if [ ! -d "$MODELS/$ID" ]; then
  echo "No model $ID in $MODELS. Choose one of:" >&2
  ls "$MODELS" >&2
  exit 1
fi
if [ "$(running)" = "$ID" ]; then
  echo "$ID is already running"
  exit 0
fi

(cd "$COLIBRI/c" && ./coli stop --port 8000 >/dev/null 2>&1) || true
i=0
while curl -s -m 2 -o /dev/null "$API" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "The previous server on port 8000 did not stop." >&2
    exit 1
  fi
  sleep 1
done

nohup "$HERE/serve.sh" "$MODELS/$ID" > "$LOG" 2>&1 &
pid=$!
i=0
until [ "$(running)" = "$ID" ]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "colibri exited while starting $ID; the end of $LOG:" >&2
    tail -15 "$LOG" >&2
    exit 1
  fi
  i=$((i + 1))
  if [ "$i" -gt 300 ]; then
    echo "$ID did not answer within 5 minutes; see $LOG" >&2
    exit 1
  fi
  sleep 1
done
echo "$ID is running on http://127.0.0.1:8000/v1 (log: $LOG)"
