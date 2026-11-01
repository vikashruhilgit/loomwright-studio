# Renders docs/design/brand-kit/: the mark, the app-icon tile, the name lockup, the README banner and the social card,
# all from the app icon's own renderer and geometry (icon-render.py, ribbon_geometry.py) and docs/design/tokens.json.
# Usage: python3 scripts/brand-kit.py   (needs numpy and Pillow, rsvg-convert, and a Chromium for the pieces with type)
#
# The colour mark is the icon's ribbon rendered on its own (ICON_RIBBON_ONLY), so it is the icon's look exactly; it is
# a lit render, so it ships as PNG. The vector mark is one colour: the band filled solid. Why not hairline threads in
# vector: the icon reads at every size because its band is a solid lit body and the threads only shade it. Drawn as 16
# separate lines on an empty band they are 0.6-1 px on a 1.4-2.4 px pitch at the sizes a mark is shown, and alias into
# moiré. The tile is app/build/icon.png resized, never redrawn.
import glob, json, os, re, shutil, subprocess, sys, tempfile
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ribbon_geometry import W, CORD, frame

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "docs", "design", "brand-kit")
SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)

# ---- tokens ------------------------------------------------------------------------------

TOKENS = json.load(open(os.path.join(ROOT, "docs", "design", "tokens.json")))
_colour = {t["name"]: t["value"] for t in TOKENS["color"]["tokens"]}
def tok(name, theme):
    v = _colour[name]
    while isinstance(v, str) and v.startswith("{"):
        v = _colour[v[1:-1]]
    return v if isinstance(v, str) else v[theme]
SANS = TOKENS["type"]["families"]["sans"]

# ---- the mark ----------------------------------------------------------------------------
# The icon is rendered straight on (tilt, spin and roll 0, orthographic), so its picture of the ribbon is the flat
# projection of the surface: a point at offset s across the band lands at C + s·Wd, z dropped. Tracing t over 4π
# follows the edge (s = ±W, where the icon lays its cords) round both "sides" of the one-sided loop until it closes,
# so the edge is one closed line, and filling it even-odd gives the band.

N = 2400
t = np.linspace(0, 4 * np.pi, 2 * N + 1)[:, None]
C, _, Wd, _ = frame(t)
EDGE = (C + W * Wd)[:, :2]
x0, y0 = (EDGE - CORD).min(0); x1, y1 = (EDGE + CORD).max(0)
BOX = 1024
FILL = 966                                            # the band's larger extent inside the box, as in the colour mark
K = FILL / max(x1 - x0, y1 - y0)
OX, OY = BOX / 2 - (x0 + x1) / 2 * K, BOX / 2 - (y0 + y1) / 2 * K

def d(points):
    p = points * K + [OX, OY]
    return "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in p[::2]) + "Z"

# One-colour marks: the band filled solid, its edge stroked at the icon's cord width.
SOLID = {"ink": tok("ink", "light"), "white": "#ffffff"}
def solid_svg(colour):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BOX} {BOX}" width="{BOX}" height="{BOX}">'
            f'<title>Loomwright Studio</title><path d="{d(EDGE)}" fill="{colour}" fill-rule="evenodd"/>'
            f'<path d="{d(EDGE)}" fill="none" stroke="{colour}" stroke-width="{2 * CORD * K:.1f}" stroke-linejoin="round"/></svg>\n')

# Colour marks: the icon's renderer, ribbon only. "tile" tones are the Dock icon's (for dark grounds); "light" is the
# same model in deeper indigo so it holds on light grounds.
COLOUR = {"colour-on-light": "light", "colour-on-dark": "tile"}
def render_ribbon(tones, out):
    env = dict(os.environ, ICON_RIBBON_ONLY="1", ICON_TONES=tones)
    subprocess.run([sys.executable, os.path.join(HERE, "icon-render.py"), "0", "0", "0", out], check=True, env=env, capture_output=True)
    return Image.open(out)

# ---- writing -----------------------------------------------------------------------------

def write(rel, text):
    path = os.path.join(OUT, rel); os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write(text); return path

def rsvg(svg_path, png_path, px):
    os.makedirs(os.path.dirname(png_path), exist_ok=True)
    subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), "-o", png_path, svg_path], check=True)

def chromium():
    found = os.environ.get("CHROMIUM") or shutil.which("chromium") or next(iter(sorted(glob.glob(os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell")))), None)
    if not found:
        sys.exit("brand-kit: no Chromium found; set CHROMIUM to a chrome or chrome-headless-shell binary")
    return found

def shoot(html_path, png_path, w, h, scale=1):
    """Screenshot a page at w×h CSS px (scale× pixels): pieces with type go through a browser for the system font."""
    os.makedirs(os.path.dirname(png_path), exist_ok=True)
    subprocess.run([chromium(), "--headless", "--hide-scrollbars", "--disable-gpu", "--default-background-color=00000000",
                    f"--force-device-scale-factor={scale}", f"--window-size={w},{h}", f"--screenshot={png_path}",
                    "file://" + html_path], check=True, capture_output=True)

def page(title, w, h, ground, body, css=""):
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><style>'
            f'html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden;background:{ground}}}'
            f'body{{font-family:{SANS};-webkit-font-smoothing:antialiased;position:relative}}{css}</style></head>'
            f'<body>{body}</body></html>\n')

def mark_img(src, px, style=""):
    return f'<img src="{src}" width="{px}" height="{px}" alt="" style="display:block;{style}">'

# ---- the lockup --------------------------------------------------------------------------
# Mark and name in plain type: SF Pro (the system sans), tracking -0.02em, "Loomwright" at 600 and "Studio" at 400 in
# the secondary ink. Measured from the mark's height M: type size 0.42M, gap 0.28M, clear space 0.5M on every side.
LOCKUP_M = 96
def lockup_html(theme, mark_src, m=LOCKUP_M):
    size, gap = round(0.42 * m), round(0.28 * m)
    body = (f'<div style="position:absolute;left:0;top:0;display:flex;align-items:center;gap:{gap}px;height:{m}px">'
            f'{mark_img(mark_src, m)}<span style="font-size:{size}px;font-weight:600;letter-spacing:-0.02em;color:{tok("ink", theme)};white-space:nowrap">'
            f'Loomwright <span style="font-weight:400;color:{tok("ink-secondary", theme)}">Studio</span></span></div>')
    return page("Lockup", 1200, m, "transparent", body)

def pad_to_content(png, clear):
    """Crop a transparent screenshot to what was drawn, then add `clear` px of clear space on every side."""
    im = Image.open(png).convert("RGBA"); x0, y0, x1, y1 = im.getbbox()
    out = Image.new("RGBA", (x1 - x0 + 2 * clear, y1 - y0 + 2 * clear), (0, 0, 0, 0))
    out.paste(im.crop((x0, y0, x1, y1)), (clear, clear)); out.save(png)

# ---- banner and social card --------------------------------------------------------------
# One direction for both: the night ground (on-accent, dark theme: the deep navy of the icon's tile), the name as in
# the lockup, the line in accent-hover, and the icon's ribbon large and cropped off the right edge.
NIGHT, NAME, SOFT = tok("on-accent", "dark"), tok("ink", "dark"), tok("accent-hover", "dark")
RIBBON_DARK = "../mark/png/loomwright-studio-mark-colour-on-dark-1024.png"
TAG = "The workshop where Wright directs the crew."

def banner():
    w, h = 1280, 320
    body = (f'{mark_img(RIBBON_DARK, 500, "position:absolute;right:-56px;top:50%;transform:translateY(-50%)")}'
            f'<div style="position:absolute;left:80px;top:0;height:{h}px;display:flex;flex-direction:column;justify-content:center">'
            f'<div style="font-size:60px;line-height:64px;font-weight:600;letter-spacing:-0.02em;color:{NAME}">Loomwright <span style="font-weight:400;color:{SOFT}">Studio</span></div>'
            f'<div style="margin-top:12px;font-size:22px;line-height:28px;color:{SOFT}">{TAG}</div></div>')
    return w, h, body

def social():
    w, h = 1200, 630
    body = (f'{mark_img(RIBBON_DARK, 700, "position:absolute;right:-150px;top:50%;transform:translateY(-50%)")}'
            f'<div style="position:absolute;left:80px;bottom:80px;width:660px">'
            f'<div style="font-size:76px;line-height:80px;font-weight:600;letter-spacing:-0.02em;color:{NAME}">Loomwright<br><span style="font-weight:400;color:{SOFT}">Studio</span></div>'
            f'<div style="margin-top:24px;font-size:26px;line-height:34px;color:{SOFT}">{TAG}</div>'
            f'<div style="margin-top:28px;font-size:18px;line-height:24px;color:{tok("ink-tertiary", "dark")}">Wright, powered by Claude</div></div>')
    return w, h, body

# ---- swatches ----------------------------------------------------------------------------
SWATCHES = ["ground", "surface", "ink", "ink-secondary", "hairline", "accent", "accent-hover", "accent-soft", "on-accent"]
def swatch_table():
    rows = ["| Token | Light | Dark | Use outside the app |", "|---|---|---|---|"]
    use = {"ground": "Page or slide background", "surface": "Cards and panels on ground", "ink": "Headlines and body text",
           "ink-secondary": "Supporting text, taglines", "hairline": "Rules and separators", "accent": "Links; the one highlight on a page",
           "accent-hover": "Dark value: \"Studio\" and the line on the night ground", "accent-soft": "Quiet highlight panels",
           "on-accent": "Text on an accent fill. Dark value: the night ground of the banner and social card"}
    for n in SWATCHES:
        cells = []
        for th in ("light", "dark"):
            hx = tok(n, th); r, g, b = (int(hx[i:i + 2], 16) for i in (1, 3, 5))
            cells.append(f"`{hx}` rgb({r}, {g}, {b})")
        rows.append(f"| `{n}` | {cells[0]} | {cells[1]} | {use[n]} |")
    return "\n".join(rows)

# ---- run ---------------------------------------------------------------------------------

def main():
    tmp = tempfile.mkdtemp()
    for old in glob.glob(os.path.join(OUT, "mark", "**", "*"), recursive=True) + glob.glob(os.path.join(OUT, "banner", "*")) + glob.glob(os.path.join(OUT, "social", "*")) + glob.glob(os.path.join(OUT, "lockup", "*")):
        if os.path.isfile(old): os.remove(old)
    os.makedirs(os.path.join(OUT, "mark", "png"), exist_ok=True)
    for way, tones in COLOUR.items():
        big = render_ribbon(tones, os.path.join(tmp, f"{way}.png"))
        for px in SIZES:
            big.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, "mark", "png", f"loomwright-studio-mark-{way}-{px}.png"))
    for way, colour in SOLID.items():
        svg = write(f"mark/loomwright-studio-mark-{way}.svg", solid_svg(colour))
        for px in SIZES:
            rsvg(svg, os.path.join(OUT, "mark", "png", f"loomwright-studio-mark-{way}-{px}.png"), px)
    icon = Image.open(os.path.join(ROOT, "app", "build", "icon.png"))
    for px in SIZES:
        dst = os.path.join(OUT, "tile", f"loomwright-studio-icon-{px}.png"); os.makedirs(os.path.dirname(dst), exist_ok=True)
        (icon if px == 1024 else icon.resize((px, px), Image.LANCZOS)).save(dst)
    for theme, way in (("light", "colour-on-light"), ("dark", "colour-on-dark")):
        html = os.path.join(tmp, f"lockup-{theme}.html")
        open(html, "w").write(lockup_html(theme, os.path.join(OUT, "mark", "png", f"loomwright-studio-mark-{way}-256.png")))
        png = os.path.join(OUT, "lockup", f"loomwright-studio-lockup-on-{theme}.png")
        shoot(html, png, 1200, LOCKUP_M, 2); pad_to_content(png, LOCKUP_M)       # 0.5M clear space, at 2x pixels
    for name, make, base, scale in (("banner", banner, "readme-banner", 2), ("social", social, "social-card", 1)):
        w, h, body = make()
        src = write(f"{name}/{base}.html", page(f"Loomwright Studio {name}", w, h, NIGHT, body))
        shoot(src, os.path.join(OUT, name, f"{base}.png"), w, h, scale)
    readme = os.path.join(OUT, "README.md")
    if os.path.exists(readme):
        text = open(readme).read()
        text = re.sub(r"(<!-- swatches:start -->\n).*?(<!-- swatches:end -->)", lambda m: m.group(1) + swatch_table() + "\n" + m.group(2), text, flags=re.S)
        open(readme, "w").write(text)
    shutil.rmtree(tmp)
    print("wrote", os.path.relpath(OUT, ROOT))

if __name__ == "__main__":
    main()
