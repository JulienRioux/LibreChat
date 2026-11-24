# colibri: a 35B MoE model in 4 GB

[colibri](https://github.com/JustVugg/colibri) runs mixture-of-experts models with the dense
weights in memory and the routed experts read from the SSD as the router asks for them. On a 24 GB
Apple Silicon Mac it serves Qwen3.6-35B-A3B from the same GGUF that llama.cpp reads, through an
OpenAI-compatible API that LibreChat uses as a custom endpoint.

Measured on an M5 Pro with 24 GB, a fresh ~3,930-token prompt and a 220-token reply
(`bench.mjs`, three runs each):

| Server | Prompt | Reply | Memory |
|---|---:|---:|---|
| Qwen3 14B (dense) on Ollama | 686 tok/s | 27 tok/s | 14 GB |
| Qwen3.6-35B-A3B Q4_K_M on llama.cpp (`--moe-cache-mib 2048 --no-repack`) | 73–91 tok/s | 18–27 tok/s | 4% of the Mac free |
| Qwen3.6-35B-A3B Q4_K_M on colibri (Metal) | 798–846 tok/s | 28–30 tok/s | 3.5–3.9 GB resident |

On the browsing tasks in `../eval/tasks.json` (three runs), colibri passed 55 of 57, the same as
the 14B on Ollama. The median task took 11–12 s against the 14B's 6 s. The other two task sets
have not been run on colibri yet.

## Build

From source: the release archives build the Qwen3.6 engine without Metal.

```bash
git clone https://github.com/JustVugg/colibri ~/colibri
```

```bash
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk make -C ~/colibri/c qwen36 METAL=1
```

- `SDKROOT` is needed when the newest SDK in the Command Line Tools is newer than their linker. The
  macOS 27 SDK with the 26.6 tools fails to link with `unknown architecture arm64e.x1`; any SDK
  that matches the tools works.
- The Makefile looks for Homebrew's `libomp` and builds single-threaded without it. An Intel
  Homebrew (under `/usr/local`) installs an x86_64 `libomp` that an arm64 link cannot use. Leave
  it uninstalled: the Metal graph does most of the work on the GPU.
- `make -C ~/colibri/c test-qwen36-graph METAL=1 PYTHON=python3.13` checks the graph against the
  CPU engine. A Python whose `site-packages` holds a package named `tests` hides colibri's.

## Import a GGUF

Each model lives in `~/models/colibri/<id>`, and `<id>` is the model id LibreChat sees:

```bash
~/colibri/c/coli import --mode link --out ~/models/colibri/qwen3.6-35b-a3b-colibri ~/models/Qwen3.6-35B-A3B-GGUF/Qwen3.6-35B-A3B-Q4_K_M.gguf
```

This writes a model directory (config, tokenizer, chat template) and links the GGUF instead of
copying it. A model directory imported elsewhere works as a link in that folder. The Metal graph
reads Q8_0, Q4_K, Q5_K, Q6_K, IQ4_NL and IQ4_XS in Qwen3.5/3.6 MoE files; a file with another type,
or a model of another family, runs on the CPU engine, with a line that says so.

## Serve and switch

```bash
browser-live/colibri/use.sh
```

```bash
browser-live/colibri/use.sh qwen3.6-35b-a3b-colibri
```

With no argument it lists the models and marks the one running. With an id it stops the running
server, starts that model on `127.0.0.1:8000` with a 32,768-token window, and returns once it
answers (about 4 s for Qwen3.6-35B-A3B). `serve.sh <directory>` runs one in the foreground.

colibri serves one model per process, and the request's `model` must be the one it serves:
another id gets `model_not_found`. Only one large model fits at a time: stop Ollama's model
first, and do not chat on an Ollama preset while colibri runs.

## librechat.yaml

```yaml
endpoints:
  custom:
    - name: 'colibri'
      apiKey: 'colibri'
      baseURL: 'http://host.docker.internal:8000/v1/'
      models:
        default: ['qwen3.6-35b-a3b-colibri']
        fetch: false
      titleConvo: true
      titleModel: 'current_model'
      summarize: false
      modelDisplayLabel: 'colibri'
modelSpecs:
  addedEndpoints: ['openAI', 'anthropic', 'google', 'agents', 'Ollama', 'colibri']
  list:
    - name: 'qwen36-35b-colibri-browser'
      label: 'Qwen3.6 35B (colibri) + Browser'
      group: 'colibri'
      webSearch: true
      mcpServers: ['playwright']
      preset:
        endpoint: 'colibri'
        model: 'qwen3.6-35b-a3b-colibri'
        maxContextTokens: 26000   # LibreChat would assume 40,960 for a qwen3 name
        max_tokens: 4096
```

List every id of `~/models/colibri` in `models.default` and keep `fetch: false`. A fetched list
holds only the model that is running, and LibreChat records a request for any other id, such as
a preset's, as an illegal model request, which counts toward a ban. With the full list, a model
that is not loaded gets colibri's `model_not_found` instead. Restart LibreChat after adding an id.

## Measuring

The eval in `../eval/` takes any OpenAI-compatible server:

```bash
node browser-live/eval/run.mjs --mcp http://127.0.0.1:9433/mcp --llm http://127.0.0.1:8000/v1 \
  --model qwen3.6-35b-a3b-colibri --runs 3 --out colibri.json
```

Keep the Mac on power and awake for the run (`caffeinate -i`). Asleep on battery, each task hit
the 600-second wait and the times meant nothing.
