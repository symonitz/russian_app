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
