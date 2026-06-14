# ruslearn — Personal Russian Learning App

Learn Russian from zero: a Cyrillic alphabet trainer, spaced-repetition
vocabulary, and AI-generated reading passages with audio.

Two ways to run it:

- **`site/` — static PWA (recommended, deployable).** No server, no API key, works
  offline, installable on your phone. Content (passages + audio) is pre-baked into
  a dataset. This is what gets deployed to a domain.
- **`src/ruslearn/` — local FastAPI app (dev).** Generates reading live via the
  Gemini CLI and audio via edge-tts. Used during development and to run the
  content-build pipeline.

See [docs/superpowers/specs/2026-06-13-russian-learning-platform-design.md](docs/superpowers/specs/2026-06-13-russian-learning-platform-design.md).

## The static PWA (`site/`)

Serve it with any static file server:

```bash
python3 -m http.server 8001 --directory site
# open http://localhost:8001
```

It uses `ts-fsrs` for scheduling, stores progress in the browser (localStorage),
and plays pre-rendered audio. Nothing else required.

### Rebuilding the dataset

The static content under `site/data/` and `site/audio/` is generated once by:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python tools/build_dataset.py   # needs the `gemini` CLI logged in + network
```

This walks the curriculum, generates one passage per level with Gemini, and
pre-renders all audio with edge-tts (Svetlana voice).

## Deploying to Cloudflare Pages

The static app is committed under `site/`, so no build step is needed.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   **Create** → **Pages** → **Connect to Git**.
2. Authorize GitHub and pick the `russian_app` repo.
3. Build settings: **Production branch** `master`, **Framework preset** None,
   **Build command** empty, **Build output directory** `site`.
4. **Save and Deploy** → you get a `https://<project>.pages.dev` URL.
5. Add a custom domain later under the project's **Custom domains** tab.

Every push to `master` auto-deploys.

## Local FastAPI app (dev)

```bash
python -m ruslearn        # serves to your phone on the LAN by default
# override host/port: RUSLEARN_HOST=127.0.0.1 RUSLEARN_PORT=8000 python -m ruslearn
pytest -q                 # 37 tests
```

## Roadmap

- More seed vocabulary so reading gets richer faster.
- Stress marks in generated passages (RUAccent) + lemmatized coverage checks.
- Second voice (Dmitry), stats/streaks, grammar notes.
