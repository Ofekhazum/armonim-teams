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
from speech import (  # noqa: E402
    CHUNK_CHARS,
    GAP_COMMA,
    GAP_PARAGRAPH,
    GAP_SENTENCE,
    WHOLE_SENTENCE,
    chunks,
    off_pace,
    plain_len,
    split_long,
    usual_rate,
)

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
        text = "\n".join(sentence(n, comma_every=4) for n in (5, 18, 31, 44, 60, 120))
        for chunk, _ in chunks(text):
            self.assertLessEqual(plain_len(chunk), WHOLE_SENTENCE, chunk)

    def test_a_sentence_is_never_cut_at_a_comma_while_a_person_could_say_it(self):
        for words in (32, 40, 60, 75):  # ~155 to ~360 letters, a comma every five words
            whole = sentence(words, comma_every=5)
            if plain_len(whole) > WHOLE_SENTENCE:
                continue
            self.assertEqual(split_long(whole), [whole])
            self.assertEqual(chunks(whole), [(whole, GAP_PARAGRAPH)])
        self.assertGreater(plain_len(sentence(60, comma_every=5)), CHUNK_CHARS)
        self.assertEqual(len(chunks(sentence(60, comma_every=5))), 1)

    def test_a_sentence_too_long_for_one_breath_is_split_at_its_commas_into_even_parts(self):
        long = sentence(100, comma_every=5)  # ~480 letters, past WHOLE_SENTENCE
        pieces = split_long(long)
        self.assertEqual(len(pieces), 2)
        self.assertTrue(all(p.endswith(",") or p == pieces[-1] for p in pieces))
        self.assertLess(abs(plain_len(pieces[0]) - plain_len(pieces[1])), 60)
        for piece in pieces:
            self.assertLessEqual(plain_len(piece), WHOLE_SENTENCE)

    def test_a_very_long_sentence_with_no_commas_is_split_at_spaces(self):
        pieces = split_long(sentence(120))
        self.assertGreater(len(pieces), 1)
        for piece in pieces:
            self.assertLessEqual(plain_len(piece), WHOLE_SENTENCE)
        self.assertEqual(len(split_long(sentence(100))), 2)

    def test_the_pauses_get_longer_with_the_break(self):
        out = chunks(sentence(100, comma_every=5) + " " + sentence(6))
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
            [sentence(101, comma_every=5) + " " + sentence(4, "!") + " " + sentence(130), sentence(12), sentence(150, comma_every=9)]
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


class Pace(unittest.TestCase):
    def test_the_usual_rate_is_the_middle_one(self):
        self.assertEqual(usual_rate([100, 100, 100, 100], [10, 8, 10, 12]), 10.0)

    def test_it_needs_a_few_chunks_before_it_judges_any(self):
        self.assertIsNone(usual_rate([100, 100], [10, 10]))
        self.assertIsNone(usual_rate([10, 10, 10, 10], [1, 1, 1, 1]))  # all too short to mean anything

    def test_a_chunk_spoken_far_faster_than_the_rest_is_flagged(self):
        # 100 letters in 4 s is 25 a second, against a usual 10: words dropped
        self.assertTrue(off_pace(100, 4.0, 10.0))

    def test_a_chunk_spoken_far_slower_is_flagged(self):
        self.assertTrue(off_pace(100, 20.0, 10.0))

    def test_an_ordinary_spread_is_left_alone(self):
        for seconds in (7.5, 9, 10, 11, 12.5):  # 13 to 8 letters a second against a usual 10
            self.assertFalse(off_pace(100, seconds, 10.0), seconds)

    def test_a_short_chunk_is_never_judged(self):
        self.assertFalse(off_pace(15, 0.5, 10.0))
        self.assertFalse(off_pace(100, 4.0, None))


class FakeModel:
    """Says every chunk at the usual pace, except what `rush` says to hurry."""

    class tts_model:  # noqa: N801
        sample_rate = 1000

    def __init__(self, rush=None):
        self.rush = rush or {}  # chunk text -> list of seconds for successive tries
        self.calls = []

    def generate(self, text, **kw):
        import numpy as np

        self.calls.append(text)
        tries = self.rush.get(text)
        seconds = (tries.pop(0) if tries else plain_len(text) / 10.0)
        return np.ones(int(seconds * 1000), dtype="float32")


class Retries(unittest.TestCase):
    # five sentences of about 55 letters each, none the same as another
    TEXT = " ".join(sentence(11, "") + " " + (ch * 3) + "." for ch in "אבגדה")

    def test_a_rushed_chunk_is_said_again_and_the_better_try_kept(self):
        chunk = chunks(self.TEXT)[2][0]
        model = FakeModel(rush={chunk: [3.0, plain_len(chunk) / 10.0]})  # first try far too fast, then right
        audio, sr = speech.speak_vox_wav(model, "ref.wav", self.TEXT, budget_s=None)
        self.assertEqual(model.calls.count(chunk), 2)
        self.assertEqual(len(chunks(self.TEXT)), 5)
        normal = sum(plain_len(c) / 10.0 for c, _ in chunks(self.TEXT))
        pauses = sum(p for _, p in chunks(self.TEXT)[:-1])
        self.assertAlmostEqual(len(audio) / sr, normal + pauses, delta=0.01)  # the retry's length, not 3 s

    def test_a_chunk_that_stays_rushed_is_tried_only_a_couple_of_times(self):
        chunk = chunks(self.TEXT)[1][0]
        model = FakeModel(rush={chunk: [3.0, 3.0, 3.0, 3.0]})
        speech.speak_vox_wav(model, "ref.wav", self.TEXT, budget_s=None)
        self.assertEqual(model.calls.count(chunk), 1 + speech.RETRIES)

    def test_an_ordinary_recording_is_not_said_twice(self):
        model = FakeModel()
        speech.speak_vox_wav(model, "ref.wav", self.TEXT, budget_s=None)
        self.assertEqual(len(model.calls), 5)


if __name__ == "__main__":
    unittest.main()
