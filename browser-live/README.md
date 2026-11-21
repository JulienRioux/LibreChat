# Browser tools and live view

A headless Chromium that models drive through six tools, built for small local models with a
16k–32k context, plus a live view of that browser in the chat's **Session** panel.

- `viewer.mjs` starts Chromium, serves the tools as an MCP server at `/mcp` on port 9333, and
  streams the active tab as MJPEG on the same port (`/stream`, `/frame.jpg`, `/status`).
- `snapshot.mjs` turns the open page into numbered lines of text; `view.mjs` decides how much of
  them to show; `find.mjs` searches them; `tools.mjs` is the six tools.
- `client/src/components/Chat/Session/BrowserLive.tsx` shows the stream as a "Browser" section in
  the Session panel while the viewer answers. Override the address at build time with
  `VITE_BROWSER_LIVE_URL` (default `http://localhost:9333`).

## What the model sees

Every tool answers with the page as text. Headings, lists and tables keep their shape, the parts
of the page are labelled, and every link, button and field has its id in brackets right after its
name:

```
All books | Paper Lantern Books
URL: http://localhost:8080/shop/
Whole page, 21 lines:
-- header --
1| Paper Lantern Books [1] · Search books [2 searchbox] Search [3 button] · Basket (0) [4]
-- aside --
3| ## Categories
4| Travel [5] (9) · Science [6] (9) · Cooking [7] (9) · History [8] (9)
-- content --
5| # All books
8| 1. (star rating Four) · The Salt Road to Varenne [10] · £45.40 · In stock · Add to basket [11 button]
20| Page 1 of 3 · next [34: /shop/?page=2]
(end of page; next page: "next" [34])
```

A page that does not fit comes back as an outline (every heading with its line number), a one-line
summary of the navigation areas, and the first lines of the main content. The model reaches the
rest with `read_page` (from a line) or `find_in_page` (search).

| Tool | Does | Returns |
|---|---|---|
| `open_url(url)` | Opens an address | The page |
| `click(id)` | Follows a link or presses a button | The page it leads to, or only what changed |
| `type_text(id, text, submit?)` | Fills a field or chooses a select option; `submit` presses Enter | The page it leads to, or what to do next |
| `find_in_page(text)` | Searches the whole page | Matching lines with line numbers, the heading above them, and table values with their column names |
| `read_page(line)` | Reads from a line | That stretch of the page and where to continue |
| `go_back()` | Returns to the previous page | The page |

Details that matter for small models:

- One rule for ids: the id follows the name it belongs to (`Travel [3]`, `Search [7 button]`), for
  links and controls alike. With mixed placement a model takes the id of the neighbour.
- Ids are checked by the server. A wrong id gets an answer that says which ids exist, never a silent
  miss. Ids stay the same while a page is open, and the same destination always has the same id.
- Every result says what lies beyond it: the next page of a list, the line to read on from, and,
  when a search finds nothing close on a page already seen in full, the site's own search field.
  These are stated as facts ("next page: ..."), not as orders: told to click, a small model keeps
  paging past the page it wanted. Persistence is asked for in the system prompt instead.
- A link whose address is only `#` is run by a script (a tab, a "load more", a year to choose), so
  it gets an id like a button. A `#section` link that only scrolls stays plain text.
- A frame appears as something to open (`Latest news [12 frame: /news/]`); opening it shows the
  document inside.
- When a click seems to change nothing, the page gets a moment to finish its requests before the
  result is written, so content that a script fetches is seen.
- When a model issues several calls at once, a click or typing that follows a page change in the
  same batch is refused: its id was chosen before the model saw the new page.
- A link shows where it leads when its text does not: another site (`[12: example.org]`) or a
  generic label such as "next" (`[34: /shop/?page=2]`).
- Short parts of one item (a product card, a byline) are folded into one line, so a search hit
  returns the title together with its price.
- A table row carries its column names with its values (`Year: 1990 | Wins: 44`); a table of
  label and value pairs becomes `Label: value` lines. Small models read a labelled value far more
  reliably than one found by its position in a row.
- Repeated blocks that are a list in all but markup (cards, search results, quotes) are numbered
  like list items, so "the second result" can be found.
- Text that exists only as an attribute is included: a full title behind an ellipsis, an icon's
  name, a star rating written as a class name.
- The page's own bracketed numbers, such as footnote markers, are rewritten so that brackets
  always mean an id.
- Only `http` and `https` addresses can be opened.

## Settings

Environment variables of the container:

| Variable | Default | Meaning |
|---|---|---|
| `VIEW_CHARS` | `5000` | Characters of page text in one tool result (about 3.6 per token). Lower it for a 16k model. |
| `BROWSER_TOOLS` | `compact` | `compact` offers the six tools. `full` also starts Playwright MCP on the same browser and offers its `browser_*` tools, for large models. Tools that a page registers through WebMCP are never offered. |
| `VIEW_PORT` | `9333` | Port for the tools and the live view. |
| `VIEW_FPS` | `3` | Frames per second of the live view. |

## docker-compose.override.yml

```yaml
services:
  api:
    image: librechat-local:browser-live   # built from this fork: docker build -t librechat-local:browser-live .
    depends_on:
      - playwright-mcp
  playwright-mcp:
    container_name: playwright-mcp
    image: mcr.microsoft.com/playwright/mcp:latest
    restart: always
    entrypoint: ["/bin/sh", "/browser-live/start.sh"]
    volumes:
      - ./browser-live:/browser-live:ro
    ports:
      - "127.0.0.1:9333:9333"
```

## librechat.yaml

```yaml
mcpSettings:
  allowedAddresses:
    - 'playwright-mcp:9333'
mcpServers:
  playwright:
    type: streamable-http
    url: http://playwright-mcp:9333/mcp
    title: 'Browser'
    serverInstructions: |
      # paste eval/prompts/compact.txt here
```

Two settings on each model preset keep the conversation inside the model's real window. Without
them LibreChat assumes 40,960 tokens for any `qwen3` model, and when the real window overflows
Ollama silently drops the oldest message first, which is the user's request:

```yaml
preset:
  endpoint: 'Ollama'
  model: 'qwen3-32k-fast:14b'
  maxContextTokens: 26000   # below num_ctx, leaving room for the reply
  max_tokens: 4096
```

If `serverInstructions` is set, do not repeat the same rules in the preset's `promptPrefix`: both
are sent.

## Ollama: tool definitions as JSON

Ollama's stock Qwen3 template writes tool definitions as Go struct text instead of JSON
([ollama/ollama#14601](https://github.com/ollama/ollama/issues/14601)) and drops a tool call from
the history when the same turn also has text. `ollama/create.sh` builds a model with a corrected
template. There are two:

- `qwen3-fast.template` never thinks, whatever the client sends. Use this one for browsing. On the
  tasks in `eval/`, Qwen3 8B and 14B completed them with thinking off; with thinking on, the same
  14B model often answered from a page it had only imagined, or reasoned in circles for minutes.
- `qwen3.template` keeps thinking switchable by the client, as the stock template does. Ollama
  turns thinking on when the client says nothing, so set `max_tokens` to bound it.

```bash
browser-live/ollama/create.sh qwen3:14b qwen3-32k-fast:14b 32768 off
```

```bash
browser-live/ollama/create.sh qwen3:14b qwen3-32k-tools:14b 32768
```

To see exactly what a model is sent, add `"_debug_render_only": true` to a request to Ollama's
`/api/chat`: it returns the rendered prompt without running the model.

## Tests

The tests need Chromium, so they run in the same image as the service:

```bash
docker run --rm --entrypoint /bin/sh -v "$PWD/browser-live:/browser-live:ro" mcr.microsoft.com/playwright/mcp:latest -c "node --test /browser-live/test/"
```

`test/site.mjs` is a fixture web site with invented content (a shop, a long article, a news site,
documentation), so results are repeatable and a model cannot answer from memory.

## Measuring a change

`eval/run.mjs` gives a local model the tools of a running service, asks the questions in
`eval/tasks.json`, and checks each answer. Start a service with the fixture site next to it, then run:

```bash
docker run -d --name browser-eval --entrypoint /bin/sh -v "$PWD/browser-live:/browser-live:ro" -p 127.0.0.1:9433:9333 \
  mcr.microsoft.com/playwright/mcp:latest -c "node /browser-live/test/site.mjs 8080 & exec /bin/sh /browser-live/start.sh"
```

```bash
node browser-live/eval/run.mjs --mcp http://127.0.0.1:9433/mcp --model qwen3-32k-fast:14b --runs 3
```

Add `--out results.json` to keep a run, and put runs side by side with:

```bash
node browser-live/eval/compare.mjs before.json after.json
```

One run of a task can go either way, so compare configurations over several runs and look at the
per-task results, not only the total. `--trace` prints every tool call as it happens.

There are three task files, chosen with `--tasks`:

- `eval/tasks.json` (the default): 16 tasks on the fixture site and 3 on a public practice site.
  The system prompt and the hints in tool results were tuned on these, so a high score here says
  little by itself.
- `eval/heldout.json` and `eval/fresh.json`: tasks on other public practice sites and question
  types. Run them after any change to the prompt or the hints: wording that helps one set has
  hurt another more than once.
