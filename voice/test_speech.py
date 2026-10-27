# Tests for how the text is broken up to be spoken (speech.chunks). Plain
# unittest, no dependencies — the voice server's heavy imports are all lazy:
#
#   python3 voice/test_speech.py
#
# The text here is made up. Real recaps are the club's own and are not kept in
# the repo; these are only shaped like them.

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import speech  # noqa: E402
from speech import CHUNK_CHARS, GAP_COMMA, GAP_PARAGRAPH, GAP_SENTENCE, chunks, plain_len, split_long  # noqa: E402

WORD = "מילה"


def sentence(words: int, end: str = ".", comma_every: int = 0) -> str:
    parts = []
    for i in range(1, words + 1):
        parts.append(WORD + ("," if comma_every and i % comma_every == 0 and i < words else ""))
    return " ".join(parts) + end


def words_of(text: str) -> list[str]:
    return re.findall(r"\S+", text)


class Chunks(unittest.TestCase):
    def test_a_breath_at_every_sentence_end(self):
        text = " ".join([sentence(8, "!"), sentence(9, "."), sentence(7, "?")])
        out = chunks(text)
        self.assertEqual(len(out), 3)
        for chunk, _ in out:
            self.assertEqual(len(re.findall(r"[.!?]", chunk)), 1, chunk)
        self.assertEqual([p for _, p in out], [GAP_SENTENCE, GAP_SENTENCE, GAP_PARAGRAPH])

    def test_no_chunk_is_longer_than_a_breath(self):
        text = "\n".join(sentence(n, comma_every=4) for n in (5, 18, 31, 44, 60))
        for chunk, _ in chunks(text):
            self.assertLessEqual(plain_len(chunk), CHUNK_CHARS, chunk)

    def test_a_long_sentence_is_split_at_its_commas_into_even_parts(self):
        long = sentence(30, comma_every=5)  # ~150 letters, a comma every five words
        pieces = split_long(long)
        self.assertEqual(len(pieces), 2)
        self.assertTrue(all(p.rstrip(".").endswith(",") or p == pieces[-1] for p in pieces))
        self.assertLess(abs(plain_len(pieces[0]) - plain_len(pieces[1])), 40)

    def test_a_sentence_with_no_commas_is_split_at_spaces(self):
        pieces = split_long(sentence(60))
        self.assertGreater(len(pieces), 1)
        for piece in pieces:
            self.assertLessEqual(plain_len(piece), CHUNK_CHARS)

    def test_the_pauses_get_longer_with_the_break(self):
        out = chunks(sentence(30, comma_every=5) + " " + sentence(6))
        pauses = [p for _, p in out]
        self.assertEqual(pauses[0], GAP_COMMA)  # inside the long sentence
        self.assertEqual(pauses[-1], GAP_PARAGRAPH)
        self.assertLess(GAP_COMMA, GAP_SENTENCE)
        self.assertLess(GAP_SENTENCE, GAP_PARAGRAPH)

    def test_the_end_of_every_paragraph_gets_the_long_pause(self):
        out = chunks("\n".join([sentence(8) + " " + sentence(8), sentence(8), sentence(8) + " " + sentence(8)]))
        self.assertEqual(len(out), 5)
        self.assertEqual([p for _, p in out], [GAP_SENTENCE, GAP_PARAGRAPH, GAP_PARAGRAPH, GAP_SENTENCE, GAP_PARAGRAPH])

    def test_a_word_or_two_is_joined_to_the_next_sentence(self):
        out = chunks("כן! " + sentence(9))
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0][0].startswith("כן!"))

    def test_a_short_but_real_sentence_keeps_its_own_breath(self):
        out = chunks("איזו בונבוניירה! " + sentence(9))
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], ("איזו בונבוניירה!", GAP_SENTENCE))

    def test_nothing_is_lost_or_said_twice(self):
        text = "\n".join(
            [sentence(31, comma_every=5) + " " + sentence(4, "!") + " " + sentence(60), sentence(12), sentence(70, comma_every=9)]
        )
        spoken = [w for chunk, _ in chunks(text) for w in words_of(chunk)]
        self.assertEqual(spoken, words_of(text))

    def test_vowel_points_do_not_count_toward_the_length(self):
        plain = " ".join([sentence(17, "."), sentence(17, ".")])
        pointed = plain.replace("מילה", "מִילָּה")
        self.assertEqual(len(chunks(plain)), len(chunks(pointed)))

    def test_blank_lines_and_empty_text(self):
        self.assertEqual(chunks(""), [])
        self.assertEqual(chunks("\n\n  \n"), [])
        self.assertEqual(len(chunks("\n\n" + sentence(5) + "\n\n")), 1)

    def test_a_single_unbreakable_word_still_comes_out_whole(self):
        word = "א" * 200
        self.assertEqual(chunks(word), [(word, GAP_PARAGRAPH)])


if __name__ == "__main__":
    unittest.main()
