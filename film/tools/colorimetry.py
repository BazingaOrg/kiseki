import numpy as np

SRGB_TO_XYZ = np.array([
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
])
D65 = np.array([0.95047, 1.0, 1.08883])
LUMA = np.array([0.2126, 0.7152, 0.0722])


def srgb_encode(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb_decode(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def lab(srgb):
    xyz = srgb_decode(srgb) @ SRGB_TO_XYZ.T / D65
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def delta_e2000(a, b):
    l1, a1, b1 = a[..., 0], a[..., 1], a[..., 2]
    l2, a2, b2 = b[..., 0], b[..., 1], b[..., 2]
    cb = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    g = 0.5 * (1 - np.sqrt(cb ** 7 / (cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dlp, dcp = l2 - l1, c2p - c1p
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dh = np.where(c1p * c2p == 0, 0, dh)
    dhp = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh / 2))
    lbp, cbp = (l1 + l2) / 2, (c1p + c2p) / 2
    hs = h1p + h2p
    hbp = np.where(c1p * c2p == 0, hs, np.where(np.abs(h1p - h2p) > 180, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2), hs / 2))
    t = 1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp)) + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63))
    dth = 30 * np.exp(-((hbp - 275) / 25) ** 2)
    rc = 2 * np.sqrt(cbp ** 7 / (cbp ** 7 + 25 ** 7))
    sl = 1 + 0.015 * (lbp - 50) ** 2 / np.sqrt(20 + (lbp - 50) ** 2)
    sc, sh = 1 + 0.045 * cbp, 1 + 0.015 * cbp * t
    rt = -np.sin(np.radians(2 * dth)) * rc
    return np.sqrt((dlp / sl) ** 2 + (dcp / sc) ** 2 + (dhp / sh) ** 2 + rt * (dcp / sc) * (dhp / sh))
