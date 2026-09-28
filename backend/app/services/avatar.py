"""
Turns an uploaded profile photo into the one shape we store: a square WebP,
AVATAR_SIZE px on a side. Pure bytes in, bytes out — no Storage, no database —
so the router owns I/O and this owns the image rules. backend/db/avatar.md has
the reasoning behind every limit here.

Re-encoding rather than storing the upload as-is is the point:

- Size. A phone photo is 2-6 MB; the stored file is tens of KB regardless.
- Privacy. EXIF (GPS position, device) is dropped, because it is never copied
  into the new file. The ICC colour profile is kept — it carries no personal
  data, and without it Display-P3 phone photos render washed out.
- Safety. The stored bytes are always an image Pillow itself wrote, so a
  polyglot or mislabeled file cannot survive the round trip.
"""

from io import BytesIO

from PIL import Image, ImageOps

# The upload limit. Must agree with the Next side: MAX_AVATAR_BYTES in
# frontend/src/lib/avatar-rules.ts, and serverActions.bodySizeLimit in
# frontend/next.config.ts, which has to stay above this plus multipart overhead
# or Next rejects the request before it reaches here.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

# Decoding cost is width x height, not file size — a small, highly compressed
# PNG can declare 30000x30000 and expand to gigabytes. 40 MP covers every
# current phone camera (48 MP sensors bin to 12 MP by default).
MAX_PIXELS = 40_000_000

# Largest on-screen avatar is 116 CSS px (the profile card); 512 covers that at
# 3x density with room for a bigger slot later.
AVATAR_SIZE = 512
WEBP_QUALITY = 82

# Pillow is told to try only these decoders, so the format is decided by the
# bytes, and a TIFF, SVG, HEIC or anything else is refused outright.
ACCEPTED_FORMATS = ("JPEG", "PNG", "WEBP")

OUTPUT_MIME = "image/webp"
OUTPUT_EXT = ".webp"


class InvalidImageError(ValueError):
    """The upload is not an image we accept. The message is safe to show."""


def normalize_avatar(data: bytes) -> bytes:
    """Validate and re-encode an upload. CPU-bound — call through
    asyncio.to_thread so decoding does not stall the event loop."""
    try:
        img = Image.open(BytesIO(data), formats=ACCEPTED_FORMATS)
    except (Image.UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError("Only JPEG, PNG and WebP images are accepted.") from exc

    # open() read only the header, so this check costs nothing and runs before
    # the pixel data is decoded.
    if img.width * img.height > MAX_PIXELS:
        raise InvalidImageError("Image dimensions are too large.")

    # Lets libjpeg decode at 1/2, 1/4 or 1/8 scale directly, so a 12 MP photo
    # never materializes at full size in memory. No-op for other formats.
    if img.format == "JPEG":
        img.draft("RGB", (AVATAR_SIZE * 2, AVATAR_SIZE * 2))

    icc_profile = img.info.get("icc_profile")

    try:
        # Phones store "rotate me" as an EXIF tag rather than rotating pixels.
        # Apply it now, since the tag is about to be dropped.
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGBA" if _has_alpha(img) else "RGB")
        # Centre-crop to a square, then downscale; an image already smaller
        # than AVATAR_SIZE is upscaled, which keeps every stored file one shape.
        img = ImageOps.fit(img, (AVATAR_SIZE, AVATAR_SIZE), Image.Resampling.LANCZOS)

        out = BytesIO()
        img.save(out, "WEBP", quality=WEBP_QUALITY, method=6, icc_profile=icc_profile)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        # Truncated or corrupt data surfaces here, on the first real decode.
        raise InvalidImageError("The image could not be read.") from exc

    return out.getvalue()


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
