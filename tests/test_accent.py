from ruslearn.accent import strip_acute, plus_to_acute

ACUTE = "́"

def test_plus_to_acute_marks_normal_vowel():
    assert plus_to_acute("магаз+ин") == "магаз" + "и" + ACUTE + "н"

def test_plus_before_yo_drops_plus_no_acute():
    assert plus_to_acute("вс+ё") == "всё"
    assert plus_to_acute("ещ+ё") == "ещё"

def test_plus_to_acute_multiword():
    out = plus_to_acute("Я любл+ю чит+ать")
    assert out == "Я любл" + "ю" + ACUTE + " чит" + "а" + ACUTE + "ть"

def test_no_plus_unchanged():
    assert plus_to_acute("не") == "не"

def test_strip_acute_removes_marks_keeps_yo():
    assert strip_acute("магази" + ACUTE + "н") == "магазин"
    assert strip_acute("всё") == "всё"

def test_strip_acute_roundtrips_plus_to_acute():
    assert strip_acute(plus_to_acute("магаз+ин")) == "магазин"
    assert strip_acute(plus_to_acute("вс+ё")) == "всё"
