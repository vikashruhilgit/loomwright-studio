# The ribbon's geometry: one source for the app icon (icon-render.py) and the brand kit's mark (brand-kit.py).
# A ribbon run round a rounded triangle with three half-twists, so it is a Möbius loop with one side.
import os
import numpy as np

TW = float(os.environ.get("ICON_TWIST0", "0"))      # where the twist sits along the loop
W = 0.22                                              # ribbon half-width
THREADS = int(os.environ.get("ICON_THREADS", "16"))   # fine threads laid side by side across the face
CORD = 0.015                                          # radius of the cord along each edge


def centre(t):
    a = 0.22                                             # how triangular the loop is (0 = circle)
    x, y = np.cos(t) + a * np.cos(2 * t), np.sin(t) - a * np.sin(2 * t)
    return np.stack([y, -x, 0 * t], -1)                  # turned so one corner points up


def frame(t):
    """Centreline C, tangent T, the ribbon's width direction Wd and its normal Nr, at each t (shape (n, 1))."""
    C = centre(t)[:, 0]
    T = np.gradient(C, axis=0); T /= np.linalg.norm(T, axis=-1, keepdims=True)
    up = np.array([0, 0, 1.0])
    N0 = up - (T * up).sum(-1)[:, None] * T; N0 /= np.linalg.norm(N0, axis=-1, keepdims=True)
    B0 = np.cross(T, N0)
    phi = 1.5 * t[:, 0] + TW                              # three half-turns, one per side: still one-sided
    Wd = np.cos(phi)[:, None] * B0 + np.sin(phi)[:, None] * N0
    Nr = np.cross(T, Wd); Nr /= np.linalg.norm(Nr, axis=-1, keepdims=True)   # ribbon normal
    return C, T, Wd, Nr


# The ribbon's look, shared the same way. The light falls from the upper left, and the tones run dark to lit. "tile"
# is the app icon's (light thread on the indigo tile); "light" is the same model in deeper indigo, for the brand
# mark on light grounds (rendered by icon-render.py with ICON_TONES=light ICON_RIBBON_ONLY=1).
L = np.array([-0.45, -0.7, 0.55]); L /= np.linalg.norm(L)
TONE_SETS = {
    "tile":  {"dark": ([118, 126, 234], [160, 168, 250]), "lit": ([218, 222, 255], [242, 243, 255]), "glow": [150, 160, 255], "spec": 255},
    "light": {"dark": ([40, 46, 150], [58, 67, 176]), "lit": ([96, 106, 222], [124, 132, 238]), "glow": [90, 100, 230], "spec": 150},
}
