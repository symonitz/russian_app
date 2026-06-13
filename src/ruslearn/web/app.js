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

const RATINGS = [
  { r: 1, label: "Again", cls: "r-again" },
  { r: 2, label: "Hard", cls: "r-hard" },
  { r: 3, label: "Good", cls: "r-good" },
  { r: 4, label: "Easy", cls: "r-easy" },
];

function show(view) {
  for (const id of ["home", "reviews", "alphabet"]) {
    $(`#view-${id}`).hidden = id !== view;
  }
  $("#back").hidden = view === "home";
  $("#title").textContent =
    view === "home" ? "READING · RUSSIAN" : view.toUpperCase();
  if (view === "home") refreshHome();
  if (view === "reviews") loadReviews();
  if (view === "alphabet") loadAlphabet();
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
async function loadReviews() {
  let due = (await api("/api/vocab/due")).cards;
  if (due.length === 0) {
    const intro = await api("/api/vocab/introduce", {
      method: "POST",
      body: JSON.stringify({ count: 5 }),
    });
    if (intro.introduced.length === 0) {
      $("#rev-stage").innerHTML = `<div class="empty">All caught up — nothing due.</div>`;
      return;
    }
    due = (await api("/api/vocab/due")).cards;
  }
  renderVocabCard(due[0]);
}

function renderVocabCard(card) {
  const stage = $("#rev-stage");
  stage.innerHTML = `
    <div class="qcard">
      <div class="big">${card.stressed}</div>
      <div class="hint">What does it mean?</div>
      <div class="answer" hidden>
        <div class="gloss">${card.gloss_en}</div>
        <div class="translit">${card.translit || ""}</div>
      </div>
    </div>
    <div class="btn-row" id="rev-actions">
      <button class="btn reveal" id="reveal">Show answer</button>
    </div>`;
  $("#reveal").onclick = () => {
    stage.querySelector(".answer").hidden = false;
    const row = $("#rev-actions");
    row.innerHTML = RATINGS.map(
      (x) => `<button class="btn ${x.cls}" data-r="${x.r}">${x.label}</button>`
    ).join("");
    row.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        await api(`/api/vocab/${card.id}/review`, {
          method: "POST",
          body: JSON.stringify({ rating: Number(b.dataset.r) }),
        });
        loadReviews();
      };
    });
  };
}

// ---- Alphabet ----
async function loadAlphabet() {
  let due = (await api("/api/alphabet/due")).cards;
  if (due.length === 0) {
    const intro = await api("/api/alphabet/introduce", {
      method: "POST",
      body: JSON.stringify({ count: 5 }),
    });
    if (intro.introduced.length === 0) {
      $("#alpha-stage").innerHTML = `<div class="empty">Alphabet complete! 🎉</div>`;
      return;
    }
    due = (await api("/api/alphabet/due")).cards;
  }
  renderLetterCard(due[0]);
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
  $("#a-reveal").onclick = () => {
    stage.querySelector(".answer").hidden = false;
    const row = $("#alpha-actions");
    row.innerHTML = RATINGS.map(
      (x) => `<button class="btn ${x.cls}" data-r="${x.r}">${x.label}</button>`
    ).join("");
    row.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        await api(`/api/alphabet/${card.id}/answer`, {
          method: "POST",
          body: JSON.stringify({ rating: Number(b.dataset.r) }),
        });
        loadAlphabet();
      };
    });
  };
}

// ---- wiring ----
document.querySelectorAll(".mode[data-go]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const go = btn.dataset.go;
    if (go === "reading") return toast("Reading mode arrives in M2 ✨");
    show(go);
  });
});
$("#back").addEventListener("click", () => show("home"));
show("home");
