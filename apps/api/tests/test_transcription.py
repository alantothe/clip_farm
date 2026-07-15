from app.services.transcription import TranscriptWord, segment_words


def test_segment_words_respects_word_and_sentence_boundaries() -> None:
    words = [
        TranscriptWord("This", 0, 300),
        TranscriptWord("is", 310, 500),
        TranscriptWord("the", 510, 700),
        TranscriptWord("hook.", 710, 1100),
        TranscriptWord("Now", 1300, 1600),
        TranscriptWord("the", 1610, 1800),
        TranscriptWord("payoff", 1810, 2200),
        TranscriptWord("lands.", 2210, 2700),
    ]

    segments = segment_words(words)

    assert segments == [
        {"start_ms": 0, "end_ms": 1100, "text": "This is the hook."},
        {"start_ms": 1300, "end_ms": 2700, "text": "Now the payoff lands."},
    ]


def test_segment_words_caps_caption_length() -> None:
    words = [TranscriptWord(f"w{index}", index * 200, index * 200 + 150) for index in range(9)]
    segments = segment_words(words)
    assert len(segments[0]["text"].split()) == 7
    assert len(segments[1]["text"].split()) == 2

