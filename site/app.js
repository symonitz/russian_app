const $ = (s) => document.querySelector(s);

// Count-based spacing: a card's "due" is a value of the global card counter
// (cards seen). Answer correct -> returns in OFFSET.good cards later; wrong ->
// OFFSET.again cards later (so it reshuffles into the next ~30). Tweakable.
const OFFSET = { again: 30, good: 100 };

// ---------- dataset (static, pre-baked) ----------
let WORDS = [];
let ALPHABET = [];
let READING = [];
let AUDIO = {};
let PATTERNS = [];

async function loadData() {
  const [w, a, r, au, pat] = await Promise.all([
    fetch("data/words.json").then((x) => x.json()),
    fetch("data/alphabet.json").then((x) => x.json()),
    fetch("data/reading.json").then((x) => x.json()),
    fetch("data/audio.json").then((x) => x.json()),
    fetch("data/patterns.json").then((x) => x.json()).catch(() => []),
  ]);
  WORDS = w.sort((p, q) => p.freq_rank - q.freq_rank);
  ALPHABET = a;
  READING = r;
  AUDIO = au;
  PATTERNS = pat || [];
}

// ---------- progress (browser localStorage) ----------
const KEY = "ruslearn.v2"; // bumped: progress format changed to count-based
const P = { vocab: {}, letters: {}, patterns: {}, counter: 0 };
function loadProgress() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) {
      P.vocab = s.vocab || {};
      P.letters = s.letters || {};
      P.patterns = s.patterns || {};
      P.counter = s.counter || 0;
    }
  } catch {
    /* first run — keep empty */
  }
}
function saveProgress() {
  localStorage.setItem(
    KEY,
    JSON.stringify({ vocab: P.vocab, letters: P.letters, patterns: P.patterns, counter: P.counter })
  );
}

// ---------- count-based scheduler ----------
function newCard() {
  return { due: P.counter, reps: 0, state: "learning" }; // due now
}
function answer(card, correct) {
  card.reps = (card.reps || 0) + 1;
  card.due = P.counter + (correct ? OFFSET.good : OFFSET.again);
  card.state = correct && card.reps >= 2 ? "known" : "learning";
  P.counter += 1;
  return card;
}
const dueNow = (card) => !!card && card.due <= P.counter;
const isKnown = (card) => !!card && card.state === "known";

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

// ---------- navigation ----------
function show(view) {
  for (const id of ["home", "reviews", "alphabet", "listen", "reading", "patterns"]) {
    $(`#view-${id}`).hidden = id !== view;
  }
  $("#back").hidden = view === "home";
  $("#title").textContent = view === "home" ? "RUSLEARN · RUSSIAN" : view.toUpperCase();
  if (view === "home") refreshHome();
  if (view === "reviews") loadReviews();
  if (view === "alphabet") loadAlphabet();
  if (view === "listen") loadListen();
  if (view === "reading") loadReading();
  if (view === "patterns") loadPatterns();
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

// ---------- Reviews (typed validation) ----------
function loadReviews() {
  nextReview();
}
function nextReview() {
  const due = WORDS.filter((w) => dueNow(P.vocab[w.id])).sort(
    (a, b) => P.vocab[a.id].due - P.vocab[b.id].due
  );
  if (due.length) return renderVocab(due[0]);
  const fresh = WORDS.find((w) => !P.vocab[w.id]);
  if (!fresh) {
    $("#rev-stage").innerHTML = `<div class="empty">All caught up — nothing due.</div>`;
    return;
  }
  P.vocab[fresh.id] = newCard();
  saveProgress();
  renderVocab(fresh);
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
  answer(P.vocab[word.id], correct);
  saveProgress();
  nextReview();
}

// ---------- Listen (audio-first) ----------
let listenMode = "words"; // "words" | "sentences"
function loadListen() {
  const stage = $("#listen-stage");
  stage.innerHTML = `
    <div class="seg">
      <button class="seg-btn ${listenMode === "words" ? "on" : ""}" data-m="words">Words</button>
      <button class="seg-btn ${listenMode === "sentences" ? "on" : ""}" data-m="sentences">Sentences</button>
    </div>
    <div id="listen-body"></div>`;
  stage.querySelectorAll(".seg-btn").forEach((b) => {
    b.onclick = () => {
      listenMode = b.dataset.m;
      loadListen();
    };
  });
  if (listenMode === "words") nextListen();
  else nextListenSentence();
}

// --- Listen: words ---
function nextListen() {
  const body = $("#listen-body");
  const intro = WORDS.filter((w) => P.vocab[w.id]);
  if (!intro.length) {
    body.innerHTML = `<div class="empty">Learn a few words in <b>Reviews</b> first,<br>then train your ear here. 🎧</div>`;
    return;
  }
  const due = intro
    .filter((w) => dueNow(P.vocab[w.id]))
    .sort((a, b) => P.vocab[a.id].due - P.vocab[b.id].due);
  const word = due[0] || intro[Math.floor(Math.random() * intro.length)];
  renderListen(word);
}
function renderListen(word) {
  const body = $("#listen-body");
  body.innerHTML = `
    <div class="qcard">
      <div class="big">🎧</div>
      <div class="speak-row">
        <button class="speak" id="li-speak" aria-label="Play audio">🔊</button>
        <button class="speak slow" id="li-slow" aria-label="Play slowly" title="Slow 0.75×">🐢</button>
      </div>
      <div class="hint">Listen — type what it means (English)</div>
      <input class="answer-input" id="lans" autocomplete="off" autocapitalize="off"
             autocorrect="off" spellcheck="false" placeholder="meaning…" />
      <div class="verdict" id="lverdict" hidden></div>
    </div>
    <div class="btn-row" id="li-actions">
      <button class="btn reveal" id="lcheck">Check</button>
    </div>`;
  $("#li-speak").onclick = () => play(word.stressed);
  $("#li-slow").onclick = () => play(word.stressed, 0.75);
  play(word.stressed); // autoplay
  const input = $("#lans");
  input.focus();
  const go = () => checkListen(word, input.value);
  $("#lcheck").onclick = go;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}
function checkListen(word, value) {
  const ok = answerMatches(value, word.gloss_en);
  $("#lans").disabled = true;
  play(word.stressed);
  const v = $("#lverdict");
  v.hidden = false;
  v.className = "verdict " + (ok ? "good" : "bad");
  v.innerHTML =
    (ok ? "✓ " : "✗ ") + `<b>${word.stressed}</b> — ${word.gloss_en} · ${word.translit || ""}`;
  const row = $("#li-actions");
  if (ok) {
    row.innerHTML = `<button class="btn r-good" id="lnext">Next →</button>`;
    $("#lnext").onclick = () => gradeListen(word, true);
  } else {
    row.innerHTML =
      `<button class="btn" id="liwr">I was right</button>` +
      `<button class="btn r-again" id="lnext">Next →</button>`;
    $("#liwr").onclick = () => gradeListen(word, true);
    $("#lnext").onclick = () => gradeListen(word, false);
  }
}
function gradeListen(word, correct) {
  answer(P.vocab[word.id], correct);
  saveProgress();
  nextListen();
}

// --- Listen: sentences (hear full sentence, then reveal text + translation) ---
function nextListenSentence() {
  const body = $("#listen-body");
  const introduced = new Set(WORDS.filter((w) => P.vocab[w.id]).map((w) => w.cyrillic));
  let pool = READING.filter((e) => e.translation && introduced.has(e.new_word.cyrillic));
  if (pool.length < 3) pool = READING.filter((e) => e.translation).slice(0, 12); // fallback: easiest
  if (!pool.length) {
    body.innerHTML = `<div class="empty">No sentences available yet.</div>`;
    return;
  }
  renderListenSentence(pool[Math.floor(Math.random() * pool.length)]);
}
// Lenient sentence check: did the typed meaning cover the key (content) words
// of the real translation? Stopwords ignored; ~half the key words = pass.
const STOPWORDS = new Set(
  "a an the to of in on at is am are be was were i you he she it we they me my your his her its our their and or not no do does did this that".split(
    " "
  )
);
function contentWords(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}
function sentenceMatches(value, translation) {
  const want = contentWords(translation);
  if (!want.length) return normalize(value) === normalize(translation);
  const got = new Set(contentWords(value));
  if (!got.size) return false;
  const hit = want.filter((w) => got.has(w)).length;
  return hit / want.length >= 0.5;
}

function renderListenSentence(data) {
  const body = $("#listen-body");
  const clean = data.passage.replace(/\[\[|\]\]/g, "");
  body.innerHTML = `
    <div class="qcard">
      <div class="big">🎧</div>
      <div class="speak-row">
        <button class="speak" id="ls-speak" aria-label="Play audio">🔊</button>
        <button class="speak slow" id="ls-slow" aria-label="Play slowly" title="Slow 0.75×">🐢</button>
      </div>
      <div class="hint">Listen — type what it means (English)</div>
      <input class="answer-input" id="lsans" autocomplete="off" autocapitalize="off"
             autocorrect="off" spellcheck="false" placeholder="meaning…" />
      <div class="verdict" id="lsverdict" hidden></div>
      <div class="answer" id="ls-answer" hidden></div>
    </div>
    <div class="btn-row" id="ls-actions"><button class="btn reveal" id="ls-check">Check</button></div>`;
  $("#ls-speak").onclick = () => play(clean);
  $("#ls-slow").onclick = () => play(clean, 0.75);
  play(clean); // autoplay full sentence
  const input = $("#lsans");
  input.focus();
  const go = () => checkListenSentence(data, clean, input.value);
  $("#ls-check").onclick = go;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}
function checkListenSentence(data, clean, value) {
  const ok = sentenceMatches(value, data.translation);
  $("#lsans").disabled = true;
  play(clean);
  const v = $("#lsverdict");
  v.hidden = false;
  v.className = "verdict " + (ok ? "good" : "bad");
  v.textContent = ok ? "✓ Got the gist" : "✗ Not quite — here it is:";
  const ans = $("#ls-answer");
  ans.hidden = false;
  ans.innerHTML =
    `<div class="passage" style="font-size:19px;margin-bottom:8px">${tokenizeHTML(data.passage)}</div>` +
    `<div class="translation-line">${data.translation}</div>`;
  ans.querySelectorAll(".rtoken").forEach((el) => (el.onclick = () => play(el.dataset.w)));
  $("#ls-actions").innerHTML = `<button class="btn ${ok ? "r-good" : "r-again"}" id="ls-next">Next →</button>`;
  $("#ls-next").onclick = nextListenSentence;
}

// ---------- Alphabet ----------
function loadAlphabet() {
  nextAlpha();
}
function nextAlpha() {
  const due = ALPHABET.filter((l) => dueNow(P.letters[l.cyrillic])).sort(
    (a, b) => P.letters[a.cyrillic].due - P.letters[b.cyrillic].due
  );
  if (due.length) return renderLetter(due[0]);
  const fresh = ALPHABET.find((l) => !P.letters[l.cyrillic]);
  if (!fresh) {
    $("#alpha-stage").innerHTML = `<div class="empty">Alphabet complete! 🎉</div>`;
    return;
  }
  P.letters[fresh.cyrillic] = newCard();
  saveProgress();
  renderLetter(fresh);
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
    row.innerHTML =
      `<button class="btn r-again" id="a-again">Again</button>` +
      `<button class="btn r-good" id="a-got">Got it ✓</button>`;
    $("#a-again").onclick = () => gradeLetter(letter, false);
    $("#a-got").onclick = () => gradeLetter(letter, true);
  };
}
function gradeLetter(letter, correct) {
  answer(P.letters[letter.cyrillic], correct);
  saveProgress();
  nextAlpha();
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

function tokenizeHTML(passage) {
  const re = /\[\[(.+?)\]\]|([\p{L}\p{M}]+)|([^\p{L}\p{M}\[\]]+)/gu;
  let html = "";
  let m;
  while ((m = re.exec(passage)) !== null) {
    if (m[1] !== undefined) html += `<span class="rtoken rnew" data-w="${m[1]}">${m[1]}</span>`;
    else if (m[2] !== undefined) html += `<span class="rtoken" data-w="${m[2]}">${m[2]}</span>`;
    else html += m[3].replace(/\n/g, "<br>");
  }
  return html;
}

function renderPassage(data, nextWord) {
  const stage = $("#reading-stage");
  const html = tokenizeHTML(data.passage);
  const nw = data.new_word || {};
  const glossary = data.glossary || {};
  stage.innerHTML = `
    <div class="qcard reading"><div class="passage">${html}</div></div>
    <div class="wordpop" id="wordpop" hidden></div>
    <div class="read-aids" id="read-aids"></div>
    <div class="newword"><span>New word: <b>${nw.cyrillic || ""}</b> — ${nw.gloss || ""}</span></div>
    <div class="subtitle" style="text-align:center;margin:8px 0;font-size:12px">
      Tap any word to hear it &amp; see its meaning.
    </div>
    <div class="btn-row"><button class="btn r-good" id="read-next">✓ Got it — next</button></div>`;
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

// ---------- Patterns (build sentences, RME-style) ----------
function shuffleA(a) {
  return a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
}
let patSession = null;

function loadPatterns() {
  const stage = $("#patterns-stage");
  if (!PATTERNS.length) {
    stage.innerHTML = `<div class="empty">No patterns available yet.</div>`;
    return;
  }
  const due = PATTERNS.filter((p) => dueNow(P.patterns[p.id])).sort(
    (a, b) => P.patterns[a.id].due - P.patterns[b.id].due
  );
  let pat = due[0] || PATTERNS.find((p) => !P.patterns[p.id]);
  if (!pat) pat = PATTERNS[Math.floor(Math.random() * PATTERNS.length)]; // all met → random review
  const items = shuffleA(pat.items).slice(0, Math.min(3, pat.items.length));
  patSession = { pattern: pat, items, idx: 0, answer: [], bank: [] };
  renderPatternItem();
}

function renderPatternItem() {
  const stage = $("#patterns-stage");
  const { pattern, items, idx } = patSession;
  const item = items[idx];
  patSession.answer = [];
  patSession.bank = shuffleA(item.answer.concat(pattern.distractors || []));
  stage.innerHTML = `
    <div class="frame-head">${pattern.frame} <span>· ${pattern.frame_gloss}</span></div>
    <div class="pat-prog">${idx + 1} / ${items.length}</div>
    <div class="qcard patcard">
      <div class="prompt-en">${item.prompt}</div>
      <div class="pans" id="pans"></div>
      <div class="ptiles" id="ptiles"></div>
      <div class="verdict" id="pverdict" hidden></div>
    </div>
    <div class="btn-row" id="pat-actions"><button class="btn reveal" id="pcheck">Check</button></div>`;
  renderPatTiles();
  $("#pcheck").onclick = () => checkPattern(item);
}

function renderPatTiles() {
  const ans = $("#pans");
  const bank = $("#ptiles");
  ans.innerHTML = patSession.answer.length ? "" : `<span class="ph">tap the words to build it…</span>`;
  patSession.answer.forEach((w, i) => {
    const b = document.createElement("button");
    b.className = "ptile on";
    b.textContent = w;
    b.onclick = () => {
      patSession.bank.push(patSession.answer.splice(i, 1)[0]);
      renderPatTiles();
    };
    ans.appendChild(b);
  });
  bank.innerHTML = "";
  patSession.bank.forEach((w, i) => {
    const b = document.createElement("button");
    b.className = "ptile";
    b.textContent = w;
    b.onclick = () => {
      patSession.answer.push(patSession.bank.splice(i, 1)[0]);
      renderPatTiles();
    };
    bank.appendChild(b);
  });
}

function checkPattern(item) {
  const ok =
    patSession.answer.length === item.answer.length &&
    patSession.answer.every((w, i) => w === item.answer[i]);
  const v = $("#pverdict");
  v.hidden = false;
  v.className = "verdict " + (ok ? "good" : "bad");
  if (!ok) {
    v.textContent = "✗ not quite — tap to rearrange";
    return;
  }
  play(item.say);
  const g = (item.gloss || [])
    .map((p) => `<span style="white-space:nowrap"><b>${p[0]}</b> <span style="opacity:.7">${p[1]}</span></span>`)
    .join('<span style="opacity:.4"> · </span>');
  v.innerHTML = `✓ <b>${item.say}</b> <span class="pop-speak" id="psay">🔊</span><div class="gloss-lite">${g}</div>`;
  $("#psay").onclick = () => play(item.say);
  $("#ptiles").querySelectorAll("button").forEach((b) => (b.disabled = true));
  $("#pans").querySelectorAll("button").forEach((b) => (b.disabled = true));
  const last = patSession.idx >= patSession.items.length - 1;
  $("#pat-actions").innerHTML = `<button class="btn r-good" id="pnext">${last ? "Done →" : "Next →"}</button>`;
  $("#pnext").onclick = () => {
    if (last) gradePattern(patSession.pattern);
    else {
      patSession.idx++;
      renderPatternItem();
    }
  };
}

function gradePattern(pat) {
  if (!P.patterns[pat.id]) P.patterns[pat.id] = newCard();
  answer(P.patterns[pat.id], true);
  saveProgress();
  loadPatterns();
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
