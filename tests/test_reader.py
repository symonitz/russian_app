import asyncio

from ruslearn.reader import ContentGenerator, Passage


class FakeProvider:
    def __init__(self, response):
        self.response = response
        self.last_prompt = None

    async def complete(self, prompt):
        self.last_prompt = prompt
        return self.response


def test_generate_parses_passage_glossary_and_new_words():
    resp = (
        '{"passage":"Это [[белый]] дом.","new_words":["белый"],'
        '"glossary":{"это":"this","дом":"house","Белый":"white"}}'
    )
    gen = ContentGenerator(FakeProvider(resp))
    p = asyncio.run(gen.generate(known=["это", "дом"], new_word="белый", new_gloss="white"))
    assert isinstance(p, Passage)
    assert "[[белый]]" in p.text
    assert p.new_words == ["белый"]
    assert p.glossary["дом"] == "house"
    assert p.glossary["белый"] == "white"  # glossary keys normalized to lowercase


def test_build_prompt_includes_known_words_and_new_word():
    gen = ContentGenerator(FakeProvider("{}"))
    prompt = gen.build_prompt(["дом", "кот"], "белый", "white")
    assert "дом" in prompt and "кот" in prompt
    assert "белый" in prompt and "white" in prompt


def test_generate_defaults_new_words_when_absent():
    resp = '{"passage":"Кот.","glossary":{"кот":"cat"}}'
    p = asyncio.run(ContentGenerator(FakeProvider(resp)).generate(["кот"], "кот", "cat"))
    assert p.new_words == ["кот"]
