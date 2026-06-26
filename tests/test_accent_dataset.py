from ruslearn.accent import accentize_passage, apply_accents

ACUTE = "́"

# Fake accentizer: marks every 'а' as stressed-ish and "restores" е->ё in "еще".
def fake_acc(text):
    return text.replace("еще", "ещё").replace("а", "а" + ACUTE)

def fake_key(text):
    return fake_acc(text).replace(ACUTE, "")

def test_passage_marker_preserved_at_right_word():
    # "мама" is the 2nd word (index 1) -> only it gets wrapped; "Я"/"тут" have no 'а'
    out = accentize_passage("Я [[мама]] тут", fake_acc)
    assert out == "Я [[ма" + ACUTE + "ма" + ACUTE + "]] тут"
    assert out.count("[[") == 1 and out.count("]]") == 1

def test_passage_no_marker_just_accentizes():
    out = accentize_passage("она там", fake_acc)
    assert "[[" not in out and "́" in out

def test_apply_accents_words_and_glossary():
    words = [{"cyrillic": "мама", "stressed": "мама"}]
    reading = [{"passage": "[[еще]] раз", "glossary": {"еще": "still", "раз": "time"}}]
    patterns = [{"items": [{"say": "мама", "answer": ["еще"], "gloss": [["еще", "still"]]}],
                 "distractors": ["раз"]}]
    apply_accents(words, reading, patterns, accentize_fn=fake_acc, key_fn=fake_key)
    assert words[0]["stressed"] == "ма́ма́"
    # glossary re-keyed via key_fn (ё restored, no acute), lowercased
    assert reading[0]["glossary"] == {"ещё": "still", "ра́з".replace("́", ""): "time"}
    # pattern answer + distractors ё-restored, no acute
    assert patterns[0]["items"][0]["answer"] == ["ещё"]
    assert patterns[0]["distractors"] == ["раз"]

def test_passage_duplicate_word_only_marked_wrapped():
    # "мама" appears twice; only the marked 2nd occurrence (index 1) is wrapped
    out = accentize_passage("мама [[мама]] дом", fake_acc)
    assert out.count("[[") == 1 and out.count("]]") == 1
    assert out == "ма" + ACUTE + "ма" + ACUTE + " [[ма" + ACUTE + "ма" + ACUTE + "]] дом"
