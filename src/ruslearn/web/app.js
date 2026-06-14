const $ = (sel) => document.querySelector(sel);

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 1800);
}

// Russian voices (edge-tts). The choice is persisted so it sticks per device.
const VOICES = { "ru-RU-SvetlanaNeural": "♀", "ru-RU-DmitryNeural": "♂" };
function getVoice() {
  return localStorage.getItem("voice") || "ru-RU-SvetlanaNeural";
}
function setVoice(v) {
  localStorage.setItem("voice", v);
  const btn = $("#voice");
  if (btn) btn.textContent = VOICES[v];
}
function toggleVoice() {
  setVoice(
    getVoice() === "ru-RU-SvetlanaNeural"
      ? "ru-RU-DmitryNeural"
      : "ru-RU-SvetlanaNeural"
  );
}

// Play the real Russian pronunciation (backend edge-tts, cached). Failures
// (e.g. offline) are swallowed — audio is an enhancement, not a blocker.
// `rate` < 1 slows playback for shadowing without re-synthesizing.
let currentAudio = null;
function playAudio(text, rate = 1) {
  if (!text) return;
  if (currentAudio) currentAudio.pause();
  const url = `/api/audio?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(getVoice())}`;
  currentAudio = new Audio(url);
  currentAudio.playbackRate = rate;
  currentAudio.play().catch(() => {});
}

const RATINGS = [
  { r: 1, label: "Again", cls: "r-again" },
  { r: 2, label: "Hard", cls: "r-hard" },
  { r: 3, label: "Good", cls: "r-good" },
  { r: 4, label: "Easy", cls: "r-easy" },
];

// "Again" (rating 1) means the learner failed — resurface the card a few
// cards later in this session instead of dropping it and pulling new material.
const AGAIN = 1;
function requeue(queue, card) {
  queue.splice(Math.min(queue.length, 3), 0, card);
}

function show(view) {
  for (const id of ["home", "reviews", "alphabet", "reading"]) {
    $(`#view-${id}`).hidden = id !== view;
  }
  $("#back").hidden = view === "home";
  $("#title").textContent =
    view === "home" ? "RUSLEARN · RUSSIAN" : view.toUpperCase();
  if (view === "home") refreshHome();
  if (view === "reviews") loadReviews();
  if (view === "alphabet") loadAlphabet();
  if (view === "reading") loadReading();
}

async function refreshHome() {
  const s = await api("/api/state");
  $("#s-known").textContent = s.vocab.known;
  $("#s-due").textContent = s.vocab.due;
  $("#s-new").textContent = s.vocab.new_today;
  $("#b-rev").textContent = `${s.vocab.due} due`;
  $("#b-alpha").textContent = `${s.alphabet.known} / ${s.alphabet.total}`;
}

// ---- Reviews ----
let revQueue = [];

async function loadReviews() {
  revQueue = (await api("/api/vocab/due")).cards;
  if (revQueue.length === 0) {
    const intro = await api("/api/vocab/introduce", {
      method: "POST",
      body: JSON.stringify({ count: 5 }),
    });
    if (intro.introduced.length === 0) {
      $("#rev-stage").innerHTML = `<div class="empty">All caught up — nothing due.</div>`;
      return;
    }
    revQueue = (await api("/api/vocab/due")).cards;
  }
  nextReview();
}

function nextReview() {
  if (revQueue.length === 0) return loadReviews(); // session cleared — refill
  renderVocabCard(revQueue[0]);
}

function renderVocabCard(card) {
  const stage = $("#rev-stage");
  stage.innerHTML = `
    <div class="qcard">
      <div class="big">${card.stressed}</div>
      <div class="speak-row">
        <button class="speak" id="rev-speak" aria-label="Play audio">🔊</button>
        <button class="speak slow" id="rev-slow" aria-label="Play slowly" title="Slow 0.75×">🐢</button>
      </div>
      <div class="hint">What does it mean?</div>
      <div class="answer" hidden>
        <div class="gloss">${card.gloss_en}</div>
        <div class="translit">${card.translit || ""}</div>
      </div>
    </div>
    <div class="btn-row" id="rev-actions">
      <button class="btn reveal" id="reveal">Show answer</button>
    </div>`;
  $("#rev-speak").onclick = () => playAudio(card.stressed);
  $("#rev-slow").onclick = () => playAudio(card.stressed, 0.75);
  $("#reveal").onclick = () => {
    stage.querySelector(".answer").hidden = false;
    playAudio(card.stressed);
    const row = $("#rev-actions");
    row.innerHTML = RATINGS.map(
      (x) => `<button class="btn ${x.cls}" data-r="${x.r}">${x.label}</button>`
    ).join("");
    row.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        const rating = Number(b.dataset.r);
        await api(`/api/vocab/${card.id}/review`, {
          method: "POST",
          body: JSON.stringify({ rating }),
        });
        revQueue.shift();
        if (rating === AGAIN) requeue(revQueue, card);
        nextReview();
      };
    });
  };
}

// ---- Alphabet ----
let alphaQueue = [];

async function loadAlphabet() {
  alphaQueue = (await api("/api/alphabet/due")).cards;
  if (alphaQueue.length === 0) {
    const intro = await api("/api/alphabet/introduce", {
      method: "POST",
      body: JSON.stringify({ count: 5 }),
    });
    if (intro.introduced.length === 0) {
      $("#alpha-stage").innerHTML = `<div class="empty">Alphabet complete! 🎉</div>`;
      return;
    }
    alphaQueue = (await api("/api/alphabet/due")).cards;
  }
  nextAlpha();
}

function nextAlpha() {
  if (alphaQueue.length === 0) return loadAlphabet(); // session cleared — refill
  renderLetterCard(alphaQueue[0]);
}

function renderLetterCard(card) {
  const stage = $("#alpha-stage");
  const contrast =
    card.friend_type === "false" && card.latin_lookalike
      ? `<div class="contrast">Looks like Latin "${card.latin_lookalike}" — but it's not.</div>`
      : "";
  stage.innerHTML = `
    <div class="qcard">
      <div class="big">${card.cyrillic}</div>
      <div class="speak-row">
        <button class="speak" id="alpha-speak" aria-label="Play audio">🔊</button>
        <button class="speak slow" id="alpha-slow" aria-label="Play slowly" title="Slow 0.75×">🐢</button>
      </div>
      <div class="hint">How is it pronounced?</div>
      ${contrast}
      <div class="answer" hidden>
        <div class="ipa">sounds like "${card.ipa}"</div>
        <div class="gloss">${card.example_word} — ${card.example_gloss}</div>
      </div>
    </div>
    <div class="btn-row" id="alpha-actions">
      <button class="btn reveal" id="a-reveal">Show sound</button>
    </div>`;
  $("#alpha-speak").onclick = () => playAudio(card.example_word);
  $("#alpha-slow").onclick = () => playAudio(card.example_word, 0.75);
  $("#a-reveal").onclick = () => {
    stage.querySelector(".answer").hidden = false;
    playAudio(card.example_word);
    const row = $("#alpha-actions");
    row.innerHTML = RATINGS.map(
      (x) => `<button class="btn ${x.cls}" data-r="${x.r}">${x.label}</button>`
    ).join("");
    row.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        const rating = Number(b.dataset.r);
        await api(`/api/alphabet/${card.id}/answer`, {
          method: "POST",
          body: JSON.stringify({ rating }),
        });
        alphaQueue.shift();
        if (rating === AGAIN) requeue(alphaQueue, card);
        nextAlpha();
      };
    });
  };
}

// ---- Reading ----
async function loadReading() {
  const stage = $("#reading-stage");
  stage.innerHTML = `<div class="empty">Generating a passage at your level…</div>`;
  let data;
  try {
    data = await api("/api/reading/next");
  } catch (e) {
    stage.innerHTML = `<div class="empty">Couldn't generate right now.</div>
      <div class="btn-row"><button class="btn reveal" id="read-retry">Try again</button></div>`;
    $("#read-retry").onclick = loadReading;
    return;
  }
  if (data.needs_more) {
    stage.innerHTML = `<div class="empty">Learn a few words in <b>Reviews</b> first,<br>then come back to read. 📖</div>`;
    return;
  }
  if (data.done) {
    stage.innerHTML = `<div class="empty">You've met every seeded word! 🎉</div>`;
    return;
  }
  renderPassage(data);
}

function renderPassage(data) {
  const stage = $("#reading-stage");
  const re = /\[\[(.+?)\]\]|([\p{L}\p{M}]+)|([^\p{L}\p{M}]+)/gu;
  let html = "";
  let m;
  while ((m = re.exec(data.passage)) !== null) {
    if (m[1] !== undefined) {
      html += `<span class="rtoken rnew" data-w="${m[1]}">${m[1]}</span>`;
    } else if (m[2] !== undefined) {
      html += `<span class="rtoken" data-w="${m[2]}">${m[2]}</span>`;
    } else {
      html += m[3].replace(/\n/g, "<br>");
    }
  }
  const nw = data.new_word || {};
  const glossary = data.glossary || {};
  stage.innerHTML = `
    <div class="qcard reading"><div class="passage">${html}</div></div>
    <div class="wordpop" id="wordpop" hidden></div>
    <div class="newword">
      <span>New word: <b>${nw.cyrillic || ""}</b> — ${nw.gloss || ""}</span>
      <button class="btn r-good" id="add-new">＋ Add to reviews</button>
    </div>
    <div class="btn-row"><button class="btn reveal" id="read-next">↻ New passage</button></div>
    <div class="subtitle" style="text-align:center;margin-top:10px;font-size:12px">
      Tap any word to hear it &amp; see its meaning.
    </div>`;
  stage.querySelectorAll(".rtoken").forEach((el) => {
    el.onclick = () => {
      const w = el.dataset.w;
      playAudio(w);
      const g = glossary[w.toLowerCase()];
      const pop = $("#wordpop");
      pop.hidden = false;
      pop.innerHTML = `<b>${w}</b>${g ? " — " + g : ""} <span class="pop-speak">🔊</span>`;
      pop.querySelector(".pop-speak").onclick = (e) => {
        e.stopPropagation();
        playAudio(w);
      };
    };
  });
  $("#read-next").onclick = loadReading;
  const addBtn = $("#add-new");
  if (nw.id) {
    addBtn.onclick = async () => {
      await api(`/api/vocab/${nw.id}/introduce`, { method: "POST" });
      addBtn.textContent = "✓ Added";
      addBtn.disabled = true;
    };
  } else {
    addBtn.style.display = "none";
  }
}

// ---- wiring ----
document.querySelectorAll(".mode[data-go]").forEach((btn) => {
  btn.addEventListener("click", () => show(btn.dataset.go));
});
$("#back").addEventListener("click", () => show("home"));
$("#voice").addEventListener("click", toggleVoice);
setVoice(getVoice()); // initialize the ♀/♂ label from saved preference
show("home");
