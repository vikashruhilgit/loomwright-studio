# Renders build/icon.png (1024px): a glossy ribbon round a rounded triangle with three half-twists (a Möbius loop),
# z-buffered with per-pixel lighting.
# Usage: python3 scripts/icon-render.py [tilt spin roll out.png]   then scripts/build-icon.sh for the .icns.
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2048                       # render at 2x, downsample to 1024
tilt, spin, roll = (float(a) for a in sys.argv[1:4]) if len(sys.argv) > 4 else (0.0, 0.0, 0.0)
out = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(__file__), "..", "build", "icon.png")

def rot(tx, ty, tz):
    tx, ty, tz = np.radians([tx, ty, tz])
    X = np.array([[1, 0, 0], [0, np.cos(tx), -np.sin(tx)], [0, np.sin(tx), np.cos(tx)]])
    Y = np.array([[np.cos(ty), 0, np.sin(ty)], [0, 1, 0], [-np.sin(ty), 0, np.cos(ty)]])
    Z = np.array([[np.cos(tz), -np.sin(tz), 0], [np.sin(tz), np.cos(tz), 0], [0, 0, 1]])
    return Z @ Y @ X

# --- the surface: a ribbon run round a rounded triangle with three half-twists, so it is a Möbius loop with one side
TW = float(os.environ.get("ICON_TWIST0", "0"))      # where the twist sits along the loop
W = 0.22                                              # ribbon half-width
t = np.linspace(0, 2 * np.pi, 14000, endpoint=False)[:, None]
s = np.linspace(-W, W, 300)[None, :]
def centre(t):
    a = 0.22                                             # how triangular the loop is (0 = circle)
    x, y = np.cos(t) + a * np.cos(2 * t), np.sin(t) - a * np.sin(2 * t)
    return np.stack([y, -x, 0 * t], -1)                  # turned so one corner points up
C = centre(t)[:, 0]
T = np.gradient(C, axis=0); T /= np.linalg.norm(T, axis=-1, keepdims=True)
up = np.array([0, 0, 1.0])
N0 = up - (T * up).sum(-1)[:, None] * T; N0 /= np.linalg.norm(N0, axis=-1, keepdims=True)
B0 = np.cross(T, N0)
phi = 1.5 * t[:, 0] + TW                              # three half-turns, one per side: still one-sided
Wd = np.cos(phi)[:, None] * B0 + np.sin(phi)[:, None] * N0
Nr = np.cross(T, Wd); Nr /= np.linalg.norm(Nr, axis=-1, keepdims=True)   # ribbon normal

# The ribbon face, made of fine threads laid side by side.
P_face = C[:, None, :] + s[..., None] * Wd[:, None, :]
N_face = np.broadcast_to(Nr[:, None, :], P_face.shape)
THREADS = int(os.environ.get("ICON_THREADS", "16"))
q = (s / (2 * W) + 0.5) * THREADS
fibre_face = (0.56 + 0.44 * np.sin(np.pi * (q % 1.0)) ** 0.7) * np.ones_like(t)

# A fine cord along each edge. A ribbon seen edge-on has no width, so at each twist the band would vanish;
# the two cords cross there instead, so the loop stays visibly one piece all the way round.
CORD = 0.015
a_ = np.linspace(0, 2 * np.pi, 64, endpoint=False)[None, :]
cords_P, cords_N = [], []
for e in (-W, W):
    ring = np.cos(a_)[..., None] * Wd[:, None, :] + np.sin(a_)[..., None] * Nr[:, None, :]
    cords_P.append(C[:, None, :] + e * Wd[:, None, :] + CORD * ring); cords_N.append(ring)
P_cord = np.concatenate(cords_P, 1); N_cord = np.concatenate(cords_N, 1)
fibre_cord = np.tile(0.95 + 0.05 * np.cos(a_ * 6 + 40 * t), (1, 2))   # a slight twist in the cord

M = rot(tilt, spin, roll)
L = np.array([-0.45, -0.7, 0.55]); L /= np.linalg.norm(L)
H = L + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)

def shade(P, N, fibre, tt, gloss):
    P = P @ M.T; N = N @ M.T
    N = np.where((N[..., 2] < 0)[..., None], -N, N)   # one-sided: light whichever way the surface faces the viewer
    ndl = np.clip((N * L).sum(-1), 0, 1)
    sp = np.clip((N * H).sum(-1), 0, 1); sp = gloss * (0.75 * sp ** 90 + 0.18 * sp ** 12)
    rim = (1 - np.abs(N[..., 2])) ** 2
    drift = (0.5 + 0.5 * np.cos(tt - 0.6)) * np.ones(N.shape[:-1])
    dark = np.array([118, 126, 234]) * (1 - drift[..., None]) + np.array([160, 168, 250]) * drift[..., None]
    lit = np.array([236, 238, 255]) * (1 - drift[..., None]) + np.array([255, 255, 255]) * drift[..., None]
    col = dark + (lit - dark) * (0.3 + 0.7 * ndl)[..., None]
    col = col * fibre[..., None] + 255 * sp[..., None] + 40 * rim[..., None]
    return P.reshape(-1, 3), np.clip(col, 0, 255).reshape(-1, 3)

Pf, Cf = shade(P_face, N_face, fibre_face, t, 1.0)
Pc, Cc = shade(P_cord, N_cord, fibre_cord, t, 1.0)
P = np.concatenate([Pf, Pc]); col = np.concatenate([Cf, Cc])

# --- project and z-buffer (larger z = nearer)
scale = S * 0.255
x = S / 2 + P[:, 0] * scale; y = S / 2 + P[:, 1] * scale
z = P[:, 2]
xi, yi = np.round(x).astype(int), np.round(y).astype(int)
ok = (xi >= 0) & (xi < S) & (yi >= 0) & (yi < S)
xi, yi, z, col = xi[ok], yi[ok], z[ok], col[ok]
order = np.argsort(z)                         # far first, near last wins
idx = yi[order] * S + xi[order]
img = np.zeros((S * S, 3)); alpha = np.zeros(S * S)
img[idx] = col[order]; alpha[idx] = 1
img = img.reshape(S, S, 3); alpha = alpha.reshape(S, S)

ribbon = Image.fromarray(np.dstack([img, alpha * 255]).astype(np.uint8))
ribbon = ribbon.filter(ImageFilter.MedianFilter(3))   # close single-pixel splat gaps
# centre the ribbon's bounding box in the tile
bx0, by0, bx1, by1 = ribbon.getbbox()
dx, dy = S // 2 - (bx0 + bx1) // 2, S // 2 - (by0 + by1) // 2

# --- tile: macOS grid (824 of 1024), indigo gradient, soft drop shadow, top sheen
tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
m = Image.new("L", (S, S), 0); ImageDraw.Draw(m).rounded_rectangle([200, 200, 1848, 1848], 370, fill=255)
grad = np.linspace(0, 1, S)[:, None, None]
bg = (np.array([84, 94, 230]) * (1 - grad) + np.array([30, 34, 118]) * grad) * np.ones((S, S, 1))
yy, xx = np.mgrid[0:S, 0:S]
glow = np.exp(-(((xx - S / 2) / (S * 0.32)) ** 2 + ((yy - S * 0.47) / (S * 0.24)) ** 2))[..., None]
bg = bg + glow * (np.array([150, 160, 255]) - bg) * 0.38
bgimg = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8)).convert("RGBA")
shadow = Image.new("RGBA", (S, S), (11, 12, 42, 0)); sm = m.filter(ImageFilter.GaussianBlur(28))
shadow.putalpha(sm.point(lambda v: int(v * 0.4))); tile.alpha_composite(shadow, (0, 24))
tile.paste(bgimg, (0, 0), m)

rs = Image.new("RGBA", (S, S), (0, 0, 0, 0)); rs.paste(ribbon, (dx, dy))
cast = Image.new("RGBA", (S, S), (16, 18, 70, 0)); cast.putalpha(rs.getchannel("A").filter(ImageFilter.GaussianBlur(26)).point(lambda v: int(v * 0.55)))
inside = Image.new("RGBA", (S, S), (0, 0, 0, 0)); inside.alpha_composite(cast, (0, 30)); inside.alpha_composite(rs)
clip = Image.new("RGBA", (S, S), (0, 0, 0, 0)); clip.paste(inside, (0, 0), m)
tile.alpha_composite(clip)

sheen = np.zeros((S, S, 4), np.uint8); sheen[..., :3] = 255
sheen[..., 3] = (np.clip(1 - np.linspace(0, 1, S) / 0.45, 0, 1) * 34)[:, None].astype(np.uint8)
sh = Image.fromarray(sheen); shm = Image.new("RGBA", (S, S), (0, 0, 0, 0)); shm.paste(sh, (0, 0), m)
tile.alpha_composite(shm)

tile.resize((1024, 1024), Image.LANCZOS).save(out)
print("wrote", out)
