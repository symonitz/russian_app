"""Generate comprehensible-input reading passages from the learner's known
words, introducing one new word, via an LLM provider (Gemini CLI)."""
from __future__ import annotations

import json
from dataclasses import dataclass

PROMPT_TEMPLATE = """You help an English speaker learn Russian through comprehensible input.

The learner KNOWS only these Russian words:
{known}

Write 3 very short, simple Russian sentences that:
- use almost only the known words above,
- introduce the ONE new word "{new_word}" ({new_gloss}) once or twice,
- wrap EVERY occurrence of the new word (in any inflected form) in double square brackets, e.g. [[{new_word}]],
- use plain Russian letters only — NO stress accent marks and NO Latin letters,
- read naturally for a beginner.

Then give a short English gloss for EVERY distinct Russian word you used (each key is the word in lowercase, no punctuation, no brackets).
Also give a short "gist" (max 6 words, the overall idea) and a natural full English "translation" of the whole passage.

Respond with ONLY this JSON and nothing else:
{{"passage": "<russian sentences>", "new_words": ["{new_word}"], "gist": "<max 6 word english summary>", "translation": "<full english translation>", "glossary": {{"<russian word>": "<english>"}}}}"""


SENTENCE_PROMPT = """Write ONE natural, everyday Russian sentence (about 4-8 words) that a native speaker would actually say, featuring the word "{word}" ({gloss}). Keep it simple and beginner-friendly, but it must be REAL, natural language — not a contrived drill.
- Wrap each occurrence of the word (in any inflected form) in double square brackets, e.g. [[{word}]].
- Use plain Russian letters only — NO stress marks and NO Latin letters.
- Give a natural full English "translation".
- Give a "glossary": a short English gloss for EVERY distinct Russian word you used (each key lowercase, no punctuation, no brackets).

Respond with ONLY this JSON and nothing else:
{{"passage": "<russian sentence>", "new_words": ["{word}"], "translation": "<english translation>", "glossary": {{"<russian word>": "<english>"}}}}"""


PATTERN_PROMPT = """You are building a sentence-PATTERN drill for a beginner learning Russian (pattern-substitution style).
Frame: "{frame}"  (meaning: "{frame_gloss}")

Produce {n} natural, useful beginner sentences that fit this frame by substituting the blank with common everyday words. If the frame is a fixed phrase with no blank, produce just that ONE sentence.

For EACH sentence give:
- "prompt": the English to say (e.g. "I want coffee")
- "answer": the Russian as an ARRAY of word tokens IN ORDER (each item exactly one word; plain Russian letters; no stress marks; no punctuation tokens)
- "say": the full Russian sentence (plain letters)
- "gloss": an array of [russian_word, english] pairs, one per word in "answer", in the same order (super-literal, word-by-word)

Also give "distractors": exactly 2 plausible real beginner Russian words that do NOT appear in any "answer" (decoy word-tiles).

Use plain Russian letters only — NO stress marks, NO Latin letters.
Respond with ONLY this JSON and nothing else:
{{"items": [{{"prompt": "<english>", "answer": ["<w1>", "<w2>"], "say": "<russian sentence>", "gloss": [["<w1>", "<en>"], ["<w2>", "<en>"]]}}], "distractors": ["<ru>", "<ru>"]}}"""


@dataclass
class Passage:
    text: str                    # passage with [[new word]] occurrences marked
    glossary: dict[str, str]     # lowercase russian word -> english
    new_words: list[str]
    gist: str = ""               # short overall-idea hint
    translation: str = ""        # full English translation


class ContentGenerator:
    def __init__(self, provider) -> None:
        self.provider = provider

    def build_prompt(self, known: list[str], new_word: str, new_gloss: str) -> str:
        return PROMPT_TEMPLATE.format(
            known=", ".join(known), new_word=new_word, new_gloss=new_gloss
        )

    async def generate(self, known: list[str], new_word: str, new_gloss: str) -> Passage:
        raw = await self.provider.complete(self.build_prompt(known, new_word, new_gloss))
        data = json.loads(raw)
        return Passage(
            text=data["passage"],
            glossary={k.lower(): v for k, v in data.get("glossary", {}).items()},
            new_words=data.get("new_words") or [new_word],
            gist=data.get("gist", ""),
            translation=data.get("translation", ""),
        )

    async def generate_sentence(self, word: str, gloss: str) -> Passage:
        """Generate ONE natural sentence featuring `word` (no known-word constraint)."""
        raw = await self.provider.complete(SENTENCE_PROMPT.format(word=word, gloss=gloss))
        data = json.loads(raw)
        return Passage(
            text=data["passage"],
            glossary={k.lower(): v for k, v in data.get("glossary", {}).items()},
            new_words=data.get("new_words") or [word],
            gist="",
            translation=data.get("translation", ""),
        )

    async def generate_pattern(self, frame: str, frame_gloss: str, n: int = 5) -> dict:
        """Generate substitution items + decoy distractors for a sentence frame."""
        raw = await self.provider.complete(
            PATTERN_PROMPT.format(frame=frame, frame_gloss=frame_gloss, n=n)
        )
        data = json.loads(raw)
        items = []
        for it in data.get("items", []):
            if it.get("answer") and it.get("say"):
                items.append(
                    {
                        "prompt": it.get("prompt", ""),
                        "answer": it["answer"],
                        "say": it["say"],
                        "gloss": it.get("gloss", []),
                    }
                )
        return {"items": items, "distractors": data.get("distractors", [])[:2]}
