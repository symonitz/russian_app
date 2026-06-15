import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
} from "./vendor/ts-fsrs.js";

const $ = (s) => document.querySelector(s);
const f = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));

// ---------- dataset (static, pre-baked) ----------
let WORDS = [];
let ALPHABET = [];
let READING = [];
let AUDIO = {};

async function loadData() {
  const [w, a, r, au] = await Promise.all([
    fetch("data/words.json").then((x) => x.json()),
    fetch("data/alphabet.json").then((x) => x.json()),
    fetch("data/reading.json").then((x) => x.json()),
    fetch("data/audio.json").then((x) => x.json()),
  ]);
  WORDS = w.sort((p, q) => p.freq_rank - q.freq_rank);
  ALPHABET = a;
  READING = r;
  AUDIO = au;
}

// ---------- progress (browser localStorage) ----------
const KEY = "ruslearn.v1";
const P = { vocab: {}, letters: {} }; // id/cyrillic -> ts-fsrs Card
function loadProgress() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) {
      P.vocab = s.vocab || {};
      P.letters = s.letters || {};
    }
  } catch {
    /* first run — keep empty */
  }
}
function saveProgress() {
  localStorage.setItem(KEY, JSON.stringify(P));
}

// ---------- SRS (ts-fsrs, in-browser) ----------
function revive(c) {
  if (!c) return c;
  return {
    ...c,
    due: new Date(c.due),
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  };
}
const newCard = () => createEmptyCard(new Date());
const review = (card, rating) => f.next(revive(card), new Date(), rating).card;
const dueNow = (card) => !!card && new Date(card.due) <= new Date();
const isKnown = (card) => !!card && card.state === State.Review;

// ---------- audio (pre-rendered clips) ----------
let currentAudio = null;
function play(text, rate = 1) {
  if (!text) return;
  const file = AUDIO[text] ?? AUDIO[text.toLowerCase()];
  if (!file) return;
  if (currentAudio) currentAudio.pause();
  currentAudio = new Audio(file);
  currentAudio.playbackRate = rate;
  currentAudio.play().catch(() => {});
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 1800);
}

const RATINGS = [
  { r: Rating.Again, label: "Again", cls: "r-again" },
  { r: Rating.Hard, label: "Hard", cls: "r-hard" },
  { r: Rating.Good, label: "Good", cls: "r-good" },
  { r: Rating.Easy, label: "Easy", cls: "r-easy" },
];
function requeue(queue, item) {
  queue.splice(Math.min(queue.length, 3), 0, item);
}

// ---------- navigation ----------
function show(view) {
  for (const id of ["home", "reviews", "alphabet", "reading"]) {
    $(`#view-${id}`).hidden = id !== view;
  }
  $("#back").hidden = view === "home";
  $("#title").textContent = view === "home" ? "RUSLEARN · RUSSIAN" : view.toUpperCase();
  if (view === "home") refreshHome();
  if (view === "reviews") loadReviews();
  if (view === "alphabet") loadAlphabet();
  if (view === "reading") loadReading();
}

function refreshHome() {
  let known = 0;
  let due = 0;
  let left = 0;
  for (const w of WORDS) {
    const c = P.vocab[w.id];
    if (!c) left++;
    else {
      if (isKnown(c)) known++;
      if (dueNow(c)) due++;
    }
  }
  const al = ALPHABET.filter((l) => isKnown(P.letters[l.cyrillic])).length;
  $("#s-known").textContent = known;
  $("#s-due").textContent = due;
  $("#s-left").textContent = left;
  $("#b-rev").textContent = `${due} due`;
  $("#b-alpha").textContent = `${al} / ${ALPHABET.length}`;
}

// ---------- Reviews ----------
let revQueue = [];
const dueWords = () => WORDS.filter((w) => dueNow(P.vocab[w.id]));

function loadReviews() {
  revQueue = dueWords();
  if (revQueue.length === 0) {
    const fresh = WORDS.filter((w) => !P.vocab[w.id]).slice(0, 5);
    if (fresh.length === 0) {
      $("#rev-stage").innerHTML = `<div class="empty">All caught up — nothing due.</div>`;
      return;
    }
    for (const w of fresh) P.vocab[w.id] = newCard();
    saveProgress();
    revQueue = dueWords();
  }
  nextReview();
}
function nextReview() {
  if (revQueue.length === 0) return loadReviews();
  renderVocab(revQueue[0]);
}
function renderVocab(word) {
  const stage = $("#rev-stage");
  stage.innerHTML = `
    <div class="qcard">
      <div class="big">${word.stressed}</div>
      <div class="speak-row">
        <button class="speak" id="rev-speak" aria-label="Play audio">🔊</button>
        <button class="speak slow" id="rev-slow" aria-label="Play slowly" title="Slow 0.75×">🐢</button>
      </div>
      <div class="hint">Type what it means (English)</div>
      <input class="answer-input" id="ans" autocomplete="off" autocapitalize="off"
             autocorrect="off" spellcheck="false" placeholder="meaning…" />
      <div class="verdict" id="verdict" hidden></div>
    </div>
    <div class="btn-row" id="rev-actions">
      <button class="btn reveal" id="check">Check</button>
    </div>`;
  $("#rev-speak").onclick = () => play(word.stressed);
  $("#rev-slow").onclick = () => play(word.stressed, 0.75);
  const input = $("#ans");
  input.focus();
  const go = () => checkAnswer(word, input.value);
  $("#check").onclick = go;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}

// Forgiving comparison: case/punct-insensitive, ignores leading to/a/the,
// accepts any comma/slash alternate, and substring matches for longer words.
function normalize(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/^(to |a |an |the )/, "")
    .replace(/[.,;!?'"()]/g, "")
    .trim();
}
function answerMatches(value, gloss) {
  const u = normalize(value);
  if (!u) return false;
  const alts = gloss.split(/[,/;]| or /).map(normalize).filter(Boolean);
  return alts.some((a) => a === u || (a.length > 3 && (a.includes(u) || u.includes(a))));
}
function checkAnswer(word, value) {
  const ok = answerMatches(value, word.gloss_en);
  $("#ans").disabled = true;
  play(word.stressed);
  const v = $("#verdict");
  v.hidden = false;
  v.className = "verdict " + (ok ? "good" : "bad");
  v.innerHTML = ok
    ? `✓ <b>${word.gloss_en}</b> · ${word.translit || ""}`
    : `✗ it means <b>${word.gloss_en}</b> · ${word.translit || ""}`;
  const row = $("#rev-actions");
  if (ok) {
    row.innerHTML = `<button class="btn r-good" id="next">Next →</button>`;
    $("#next").onclick = () => grade(word, true);
  } else {
    row.innerHTML =
      `<button class="btn" id="iwr">I was right</button>` +
      `<button class="btn r-again" id="next">Next →</button>`;
    $("#iwr").onclick = () => grade(word, true);
    $("#next").onclick = () => grade(word, false);
  }
}
function grade(word, correct) {
  P.vocab[word.id] = review(P.vocab[word.id], correct ? Rating.Good : Rating.Again);
  saveProgress();
  revQueue.shift();
  if (!correct) requeue(revQueue, word);
  nextReview();
}

// ---------- Alphabet ----------
let alphaQueue = [];
const dueLetters = () => ALPHABET.filter((l) => dueNow(P.letters[l.cyrillic]));

function loadAlphabet() {
  alphaQueue = dueLetters();
  if (alphaQueue.length === 0) {
    const fresh = ALPHABET.filter((l) => !P.letters[l.cyrillic]).slice(0, 5);
    if (fresh.length === 0) {
      $("#alpha-stage").innerHTML = `<div class="empty">Alphabet complete! 🎉</div>`;
      return;
    }
    for (const l of fresh) P.letters[l.cyrillic] = newCard();
    saveProgress();
    alphaQueue = dueLetters();
  }
  nextAlpha();
}
function nextAlpha() {
  if (alphaQueue.length === 0) return loadAlphabet();
  renderLetter(alphaQueue[0]);
}
function renderLetter(letter) {
  const stage = $("#alpha-stage");
  const contrast =
    letter.friend_type === "false" && letter.latin_lookalike
      ? `<div class="contrast">Looks like Latin "${letter.latin_lookalike}" — but it's not.</div>`
      : "";
  stage.innerHTML = `
    <div class="qcard">
      <div class="big">${letter.cyrillic}</div>
      <div class="speak-row">
        <button class="speak" id="alpha-speak" aria-label="Play audio">🔊</button>
        <button class="speak slow" id="alpha-slow" aria-label="Play slowly" title="Slow 0.75×">🐢</button>
      </div>
      <div class="hint">How is it pronounced?</div>
      ${contrast}
      <div class="answer" hidden>
        <div class="ipa">sounds like "${letter.ipa}"</div>
        <div class="gloss">${letter.example_word} — ${letter.example_gloss}</div>
      </div>
    </div>
    <div class="btn-row" id="alpha-actions">
      <button class="btn reveal" id="a-reveal">Show sound</button>
    </div>`;
  $("#alpha-speak").onclick = () => play(letter.example_word);
  $("#alpha-slow").onclick = () => play(letter.example_word, 0.75);
  $("#a-reveal").onclick = () => {
    stage.querySelector(".answer").hidden = false;
    play(letter.example_word);
    const row = $("#alpha-actions");
    row.innerHTML = RATINGS.map(
      (x) => `<button class="btn ${x.cls}" data-r="${x.r}">${x.label}</button>`
    ).join("");
    row.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        const rating = Number(b.dataset.r);
        P.letters[letter.cyrillic] = review(P.letters[letter.cyrillic], rating);
        saveProgress();
        alphaQueue.shift();
        if (rating === Rating.Again) requeue(alphaQueue, letter);
        nextAlpha();
      };
    });
  };
}

// ---------- Reading ----------
const introducedCount = () => Object.keys(P.vocab).length;

function loadReading() {
  const stage = $("#reading-stage");
  if (introducedCount() < 3) {
    stage.innerHTML = `<div class="empty">Learn a few words in <b>Reviews</b> first,<br>then come back to read. 📖</div>`;
    return;
  }
  // Next passage = lowest-level one whose new word you haven't met yet.
  // (Skips any levels that failed to generate.)
  const introduced = new Set(WORDS.filter((w) => P.vocab[w.id]).map((w) => w.cyrillic));
  const entry = READING
    .filter((e) => !introduced.has(e.new_word.cyrillic))
    .sort((a, b) => a.level - b.level)[0];
  if (!entry) {
    stage.innerHTML = `<div class="empty">You've read everything available! 🎉</div>`;
    return;
  }
  const nextWord = WORDS.find((w) => w.cyrillic === entry.new_word.cyrillic);
  renderPassage(entry, nextWord);
}

function renderPassage(data, nextWord) {
  const stage = $("#reading-stage");
  const re = /\[\[(.+?)\]\]|([\p{L}\p{M}]+)|([^\p{L}\p{M}\[\]]+)/gu;
  let html = "";
  let m;
  while ((m = re.exec(data.passage)) !== null) {
    if (m[1] !== undefined) html += `<span class="rtoken rnew" data-w="${m[1]}">${m[1]}</span>`;
    else if (m[2] !== undefined) html += `<span class="rtoken" data-w="${m[2]}">${m[2]}</span>`;
    else html += m[3].replace(/\n/g, "<br>");
  }
  const nw = data.new_word || {};
  const glossary = data.glossary || {};
  stage.innerHTML = `
    <div class="qcard reading"><div class="passage">${html}</div></div>
    <div class="wordpop" id="wordpop" hidden></div>
    <div class="read-aids" id="read-aids"></div>
    <div class="newword">
      <span>New word: <b>${nw.cyrillic || ""}</b> — ${nw.gloss || ""}</span>
      <button class="btn r-good" id="read-next">✓ Got it — next</button>
    </div>
    <div class="subtitle" style="text-align:center;margin-top:10px;font-size:12px">
      Tap any word to hear it &amp; see its meaning.
    </div>`;
  stage.querySelectorAll(".rtoken").forEach((el) => {
    el.onclick = () => {
      const w = el.dataset.w;
      play(w);
      const g = glossary[w.toLowerCase()];
      const pop = $("#wordpop");
      pop.hidden = false;
      pop.innerHTML = `<b>${w}</b>${g ? " — " + g : ""} <span class="pop-speak">🔊</span>`;
      pop.querySelector(".pop-speak").onclick = (e) => {
        e.stopPropagation();
        play(w);
      };
    };
  });

  // Gist hint first, then reveal the full translation on a second tap.
  const aids = $("#read-aids");
  const gist = (data.gist || "").trim();
  const translation = (data.translation || "").trim();
  if (gist || translation) {
    let phase = gist ? 0 : 1;
    const btn = document.createElement("button");
    btn.className = "btn ghost";
    btn.textContent = gist ? "💡 Hint" : "Show translation";
    const out = document.createElement("div");
    out.className = "aid-out";
    aids.append(btn, out);
    btn.onclick = () => {
      if (phase === 0) {
        out.innerHTML = `<div class="gist-line">“${gist}”</div>`;
        if (translation) {
          btn.textContent = "Show full translation";
          phase = 1;
        } else {
          btn.remove();
        }
      } else {
        out.insertAdjacentHTML("beforeend", `<div class="translation-line">${translation}</div>`);
        btn.remove();
      }
    };
  }

  $("#read-next").onclick = () => {
    P.vocab[nextWord.id] = newCard(); // reading introduces the new word into SRS
    saveProgress();
    loadReading();
  };
}

// ---------- boot ----------
document.querySelectorAll(".mode[data-go]").forEach((b) => {
  b.addEventListener("click", () => show(b.dataset.go));
});
$("#back").addEventListener("click", () => show("home"));

(async function init() {
  loadProgress();
  try {
    await loadData();
  } catch (e) {
    document.getElementById("view-home").innerHTML =
      `<div class="empty">Couldn't load the dataset.</div>`;
    return;
  }
  show("home");
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
