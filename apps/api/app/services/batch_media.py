"""Slice Sequence-level images into one render segment's local clock."""


def media_in_span(media: list, start_ms: int, duration_ms: int) -> list[tuple]:
    end_ms = start_ms + duration_ms
    return [
        (
            item,
            max(0, item.start_ms - start_ms),
            min(duration_ms, item.end_ms - start_ms),
        )
        for item in media
        if item.end_ms > start_ms and item.start_ms < end_ms
    ]
