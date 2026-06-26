"""Stress + ё helpers: convert RUAccent '+'-format to our display/key forms."""
from __future__ import annotations

import regex  # supports \p{L}\p{M}; installed via ruaccent

ACUTE = "́"  # combining acute accent (placed AFTER the stressed vowel)
_VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")


def strip_acute(s: str) -> str:
    """Remove combining-acute stress marks; ё (U+0451) is untouched."""
    return s.replace(ACUTE, "")


def plus_to_acute(s: str) -> str:
    """RUAccent marks stress as '+' before the vowel. Convert to a combining
    acute after the vowel. ё is inherently stressed, so '+ё' -> 'ё' (no acute)."""
    out = []
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "+" and i + 1 < len(s) and s[i + 1] in _VOWELS:
            v = s[i + 1]
            if v in ("ё", "Ё"):
                out.append(v)            # ё already implies stress
            else:
                out.append(v + ACUTE)
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


_accentizer = None


def _get_accentizer():
    global _accentizer
    if _accentizer is None:
        from ruaccent import RUAccent  # heavy import; defer until needed
        acc = RUAccent()
        try:
            acc.load(omograph_model_size="turbo", use_dictionary=True)
        except TypeError:
            acc.load()
        _accentizer = acc
    return _accentizer


def accentize(text: str) -> str:
    """Display form: accurate stress (combining acute) + ё restored.
    Idempotent — strips any existing acute first so re-runs are safe."""
    if not text or not text.strip():
        return text
    base = strip_acute(text)
    try:
        marked = _get_accentizer().process_all(base)
    except Exception:  # noqa: BLE001 — never crash the build on one string
        return text
    return plus_to_acute(marked)


def audio_key(text: str) -> str:
    """Lookup key for audio/glossary: ё kept, stress marks removed."""
    return strip_acute(accentize(text))


_WORD = regex.compile(r"[\p{L}\p{M}]+")


def _marked_index(passage: str):
    i = passage.find("[[")
    if i < 0:
        return None
    return len(_WORD.findall(passage[:i]))


def accentize_passage(passage: str, accentize_fn=None) -> str:
    fn = accentize_fn or accentize
    idx = _marked_index(passage)
    plain = passage.replace("[[", "").replace("]]", "")
    acc = fn(plain)
    if idx is None:
        return acc
    counter = {"n": -1}

    def repl(m):
        counter["n"] += 1
        return f"[[{m.group(0)}]]" if counter["n"] == idx else m.group(0)

    # Invariant: the accent fn is purely additive (adds combining marks only),
    # so it never adds/removes/splits word tokens — the index stays aligned.
    return _WORD.sub(repl, acc)


def apply_accents(words, reading, patterns, accentize_fn=None, key_fn=None) -> None:
    acc = accentize_fn or accentize
    key = key_fn or audio_key
    for w in words:
        w["stressed"] = acc(w.get("cyrillic", w.get("stressed", "")))
    for e in reading:
        e["passage"] = accentize_passage(e["passage"], acc)
        e["glossary"] = {key(k).lower(): v for k, v in (e.get("glossary") or {}).items()}
    for p in patterns:
        for item in p.get("items", []):
            item["say"] = acc(item["say"])
            item["answer"] = [key(x) for x in item.get("answer", [])]
            item["gloss"] = [[key(ru), en] for ru, en in item.get("gloss", [])]
        p["distractors"] = [key(d) for d in p.get("distractors", [])]
