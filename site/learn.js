// Pure logic for the Learn-to-Read module (imported by app.js + unit-tested).

// Words whose every Cyrillic letter is in the introduced set (case-insensitive).
export function readableWords(words, introduced) {
  const have = new Set([...introduced].map((c) => c.toLowerCase()));
  return words.filter((w) =>
    [...w.ru.toLowerCase()].every((ch) => !/\p{L}/u.test(ch) || have.has(ch))
  );
}

// A focused checkpoint subset (first n words).
export function miniTest(words, n = 6) {
  return words.slice(0, Math.max(0, n));
}
