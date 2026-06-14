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

Respond with ONLY this JSON and nothing else:
{{"passage": "<russian sentences>", "new_words": ["{new_word}"], "glossary": {{"<russian word>": "<english>"}}}}"""


@dataclass
class Passage:
    text: str                    # passage with [[new word]] occurrences marked
    glossary: dict[str, str]     # lowercase russian word -> english
    new_words: list[str]


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
        )
