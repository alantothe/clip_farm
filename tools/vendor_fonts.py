#!/usr/bin/env python
"""Vendor the Title fonts into `apps/api/fonts/`.

The browser preview and the ffmpeg renderer have to load the *same file*, or a
Title moves and re-wraps between the stage and the export. So the faces are
committed to the repo rather than fetched from Google's CDN at runtime: the
worker renders offline, and a webfont that 404s would silently fall back to
DejaVu Sans and burn the wrong thing into a finished video.

Upstream is the `google/fonts` repo, which ships some families as static TTFs
per weight and others as a single variable font. libass renders a variable font
at its default instance only — asking for weight 900 would quietly give you 400
— so variable families are instanced here, at vendoring time, into one static
file per weight.

Every vendored file gets a **unique internal family name** (`Inter Black`, not
`Inter` at weight 900). libass matches faces by name and has only a bold
boolean, no weight axis; a unique name per file is what makes "the weight the
operator picked" and "the file libass opened" the same thing. `catalog.json`
records that name, so the renderer never has to guess it.

Italics are not vendored. libass synthesises an oblique when a style asks for
italic and no italic face exists, and so does every browser, so the two agree
without doubling the payload.

Run it from the repo root:

    apps/api/.venv/bin/python tools/vendor_fonts.py

It needs network access and `fonttools`; both are development-time only.
"""

from __future__ import annotations

import json
import shutil
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[1]
FONTS_DIR = REPO_ROOT / "apps/api/fonts"
RAW = "https://raw.githubusercontent.com/google/fonts/main"

# The weight names Google uses in file names, and that the unique family names
# built here reuse. 400 is the odd one out: its face is named for the family
# alone, because that is what the upstream static files already do.
WEIGHT_NAMES = {
    100: "Thin",
    200: "ExtraLight",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "SemiBold",
    700: "Bold",
    800: "ExtraBold",
    900: "Black",
}


@dataclass(frozen=True)
class Family:
    """One family to vendor, and the weights worth having of it.

    `directory` is the path under the upstream repo — the licence folder is
    part of it, because a family's licence decides where it lives (`ofl`,
    `apache`, `ufl`).
    """

    id: str
    name: str
    category: str
    directory: str
    weights: tuple[int, ...]
    #: Set when the upstream file names do not follow `<Name>-<Weight>.ttf`.
    file_stem: str | None = None
    #: The variable font to instance, when the family ships no static files.
    variable: str | None = None
    #: Axes to pin besides `wght`, for families carrying `opsz` or `wdth`.
    pin: dict[str, float] = field(default_factory=dict)

    @property
    def stem(self) -> str:
        return self.file_stem or self.name.replace(" ", "")


# Roughly the faces that actually appear on Reels and TikTok: a few workhorse
# sans families, the condensed and heavy display faces that hook text is set
# in, two serifs, and the handful of script and novelty faces people reach for.
FAMILIES: tuple[Family, ...] = (
    # Workhorse sans
    Family("inter", "Inter", "sans", "ofl/inter", (400, 700, 900),
           variable="Inter[opsz,wght].ttf", pin={"opsz": 32}),
    Family("roboto", "Roboto", "sans", "ofl/roboto", (400, 700, 900),
           variable="Roboto[wdth,wght].ttf", pin={"wdth": 100}),
    Family("open-sans", "Open Sans", "sans", "ofl/opensans", (400, 700, 800),
           variable="OpenSans[wdth,wght].ttf", pin={"wdth": 100}),
    Family("lato", "Lato", "sans", "ofl/lato", (400, 700, 900)),
    Family("montserrat", "Montserrat", "sans", "ofl/montserrat", (400, 700, 900),
           variable="Montserrat[wght].ttf"),
    Family("poppins", "Poppins", "sans", "ofl/poppins", (400, 700, 900)),
    Family("nunito", "Nunito", "sans", "ofl/nunito", (400, 700, 900),
           variable="Nunito[wght].ttf"),
    Family("raleway", "Raleway", "sans", "ofl/raleway", (400, 700, 900),
           variable="Raleway[wght].ttf"),
    Family("rubik", "Rubik", "sans", "ofl/rubik", (400, 700, 900),
           variable="Rubik[wght].ttf"),
    Family("work-sans", "Work Sans", "sans", "ofl/worksans", (400, 700, 900),
           variable="WorkSans[wght].ttf"),
    Family("dm-sans", "DM Sans", "sans", "ofl/dmsans", (400, 700, 900),
           variable="DMSans[opsz,wght].ttf", pin={"opsz": 14}),
    Family("space-grotesk", "Space Grotesk", "sans", "ofl/spacegrotesk", (400, 700),
           variable="SpaceGrotesk[wght].ttf"),
    Family("barlow", "Barlow", "sans", "ofl/barlow", (400, 700, 900)),
    # Condensed and heavy: what hook text is set in
    Family("roboto-condensed", "Roboto Condensed", "display", "ofl/robotocondensed",
           (400, 700), variable="RobotoCondensed[wght].ttf"),
    Family("oswald", "Oswald", "display", "ofl/oswald", (400, 700),
           variable="Oswald[wght].ttf"),
    Family("teko", "Teko", "display", "ofl/teko", (400, 700),
           variable="Teko[wght].ttf"),
    Family("bebas-neue", "Bebas Neue", "display", "ofl/bebasneue", (400,)),
    Family("anton", "Anton", "display", "ofl/anton", (400,)),
    Family("archivo-black", "Archivo Black", "display", "ofl/archivoblack", (400,)),
    Family("fjalla-one", "Fjalla One", "display", "ofl/fjallaone", (400,)),
    Family("bangers", "Bangers", "display", "ofl/bangers", (400,)),
    # Serif
    Family("playfair-display", "Playfair Display", "serif", "ofl/playfairdisplay",
           (400, 700, 900), variable="PlayfairDisplay[wght].ttf"),
    Family("merriweather", "Merriweather", "serif", "ofl/merriweather", (400, 700, 900),
           variable="Merriweather[opsz,wdth,wght].ttf", pin={"opsz": 18, "wdth": 100}),
    # Script and novelty
    Family("permanent-marker", "Permanent Marker", "script", "apache/permanentmarker", (400,)),
    Family("caveat", "Caveat", "script", "ofl/caveat", (400, 700),
           variable="Caveat[wght].ttf"),
    Family("pacifico", "Pacifico", "script", "ofl/pacifico", (400,)),
    Family("lobster", "Lobster", "script", "ofl/lobster", (400,)),
)


def fetch(url: str, destination: Path) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            destination.write_bytes(response.read())
        return True
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        raise


def unique_face_name(family: Family, weight: int) -> str:
    """The internal family name a vendored face is given.

    Unique per file, because that is the only handle libass has: it matches on
    the name and carries a bold flag, not a weight.
    """
    return family.name if weight == 400 else f"{family.name} {WEIGHT_NAMES[weight]}"


def rename_face(font, face_name: str) -> None:
    """Rewrite the face's own name records to `face_name`, subfamily Regular.

    Both the renderer and the browser address a file through this name, so it
    has to be the same string in `catalog.json` and inside the TTF. Setting the
    subfamily to Regular everywhere keeps libass's bold flag out of it — a face
    named "Inter Black" is not "Inter, bolded".
    """
    table = font["name"]
    postscript = face_name.replace(" ", "")
    for record in list(table.names):
        if record.nameID in (1, 3, 4, 6, 16, 17):
            table.removeNames(record.nameID, record.platformID, record.platEncID, record.langID)
    for platform_id, plat_enc_id, lang_id in ((3, 1, 0x409), (1, 0, 0)):
        table.setName(face_name, 1, platform_id, plat_enc_id, lang_id)
        table.setName("Regular", 2, platform_id, plat_enc_id, lang_id)
        table.setName(face_name, 4, platform_id, plat_enc_id, lang_id)
        table.setName(postscript, 6, platform_id, plat_enc_id, lang_id)
        table.setName(f"Clip Farm vendored {face_name}", 3, platform_id, plat_enc_id, lang_id)


def read_face_name(path: Path) -> tuple[str, bool]:
    """The family name inside a TTF, and whether its subfamily is Bold.

    Read rather than assumed: Google's own static files name `Poppins-Black`
    as the family "Poppins Black" but `Poppins-Bold` as "Poppins"/Bold, and
    libass needs to be told which of the two it is looking at.
    """
    from fontTools.ttLib import TTFont

    with TTFont(path, lazy=True) as font:
        name = font["name"].getDebugName(1) or path.stem
        subfamily = (font["name"].getDebugName(2) or "Regular").lower()
    return name, "bold" in subfamily


def build_static(source: Path, destination: Path, family: Family, weight: int) -> None:
    """Pin a variable font to one weight and give it its unique name."""
    from fontTools import ttLib
    from fontTools.varLib import instancer

    font = ttLib.TTFont(source)
    font = instancer.instantiateVariableFont(font, {"wght": weight, **family.pin}, inplace=True)
    rename_face(font, unique_face_name(family, weight))
    font.save(destination)


def rename_downloaded(path: Path, family: Family, weight: int) -> None:
    """Rename an upstream static file to its unique face name.

    Upstream is not consistent about this and cannot be trusted to be:
    `Lato-Black.ttf` and `Lato-Regular.ttf` both declare the family "Lato" with
    subfamily "Regular", putting the real weight only in the typographic names
    (nameID 16/17) that libass does not read. Left alone, asking libass for
    "Lato" at Black would hand back whichever of the two it happened to index
    first — a wrong weight burned into a finished video, with nothing to see in
    the logs. Renaming every face, not only the instanced ones, is what makes
    one name mean one file.
    """
    from fontTools import ttLib

    font = ttLib.TTFont(path)
    rename_face(font, unique_face_name(family, weight))
    font.save(path)


def vendor(family: Family, work_dir: Path) -> list[dict]:
    faces: list[dict] = []

    variable_source: Path | None = None
    if family.variable:
        variable_source = work_dir / family.variable
        if not fetch(f"{RAW}/{family.directory}/{family.variable}", variable_source):
            raise SystemExit(f"{family.name}: {family.variable} is gone from upstream")

    for weight in family.weights:
        file_name = f"{family.stem}-{WEIGHT_NAMES[weight]}.ttf"
        destination = FONTS_DIR / file_name

        if variable_source is not None:
            build_static(variable_source, destination, family, weight)
        elif fetch(f"{RAW}/{family.directory}/{file_name}", destination):
            rename_downloaded(destination, family, weight)
        else:
            raise SystemExit(f"{family.name}: no static {file_name} and no variable font")

        face_name, bold = read_face_name(destination)
        faces.append(
            {
                "id": f"{family.id}-{weight}",
                "family": family.id,
                "family_name": family.name,
                "category": family.category,
                "weight": weight,
                "weight_label": WEIGHT_NAMES[weight],
                "file": file_name,
                # What libass is told to look for, and what it will find.
                "face_name": face_name,
                "face_bold": bold,
            }
        )
        print(f"  {file_name}  ({face_name}{', bold' if bold else ''})")

    licence = FONTS_DIR / "licences" / f"{family.id}.txt"
    licence.parent.mkdir(parents=True, exist_ok=True)
    for candidate in ("OFL.txt", "LICENSE.txt", "UFL.txt"):
        if fetch(f"{RAW}/{family.directory}/{candidate}", licence):
            break
    else:
        raise SystemExit(f"{family.name}: no licence file found upstream")

    return faces


def main() -> int:
    if FONTS_DIR.exists():
        shutil.rmtree(FONTS_DIR)
    FONTS_DIR.mkdir(parents=True)

    faces: list[dict] = []
    with TemporaryDirectory() as temp:
        for family in FAMILIES:
            print(family.name)
            faces.extend(vendor(family, Path(temp)))

    catalog = {
        "generated_by": "tools/vendor_fonts.py",
        "source": "https://github.com/google/fonts",
        "families": [
            {
                "id": family.id,
                "name": family.name,
                "category": family.category,
                "weights": list(family.weights),
            }
            for family in FAMILIES
        ],
        "faces": faces,
    }
    (FONTS_DIR / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")

    total = sum(path.stat().st_size for path in FONTS_DIR.rglob("*.ttf"))
    print(f"\n{len(faces)} faces across {len(FAMILIES)} families, {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
