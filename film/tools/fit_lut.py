import argparse
import base64
import json
import os
import subprocess
from concurrent.futures import ProcessPoolExecutor
from io import BytesIO

import numpy as np
import rawpy
from PIL import Image

from colorimetry import LUMA, delta_e2000, lab, srgb_encode

W, H = 480, 320
N = 17


def read_metadata(raw_dir):
    out = subprocess.run(
        ['exiftool', '-j', '-q', '-FileName', '-FilmMode', '-AutoDynamicRange', '-ISO', '-ext', 'RAF', raw_dir],
        check=False, capture_output=True, text=True,
    ).stdout
    return {m['FileName']: m for m in json.loads(out or '[]')}


def box(img):
    return np.stack([np.asarray(Image.fromarray(img[..., c]).resize((W, H), Image.BOX)) for c in range(3)], -1)


def decode_pair(args):
    path, cache = args
    name = os.path.splitext(os.path.basename(path))[0]
    dst = os.path.join(cache, name + '.npz')
    if os.path.exists(dst):
        return name
    if os.path.getsize(path) == 0:
        return None
    with rawpy.imread(path) as raw:
        thumb = raw.extract_thumb()
        if thumb.format != rawpy.ThumbFormat.JPEG:
            return None
        target = Image.open(BytesIO(thumb.data)).convert('RGB').resize((W, H), Image.BOX)
        linear = raw.postprocess(use_camera_wb=True, no_auto_bright=True, gamma=(1, 1), output_bps=16,
                                 output_color=rawpy.ColorSpace.sRGB, half_size=True)
    neutral = box(linear.astype(np.float32) / 65535.0)
    np.savez_compressed(dst, neutral=neutral, target=np.asarray(target, np.float32) / 255.0)
    return name


def resample(img, s, dx, dy):
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    sx = np.clip(((xs - w / 2) / s + w / 2 + dx).round().astype(int), 0, w - 1)
    sy = np.clip(((ys - h / 2) / s + h / 2 + dy).round().astype(int), 0, h - 1)
    return img[sy, sx]


def align(neutral, target):
    a = srgb_encode(neutral).mean(-1)
    gb = np.hypot(*np.gradient(target.mean(-1)))[40:-40, 60:-60].ravel()
    best = (-1.0, 1.0, 0, 0)
    for s in np.arange(0.96, 1.045, 0.01):
        for dx in range(-4, 5, 2):
            for dy in range(-4, 5, 2):
                ga = np.hypot(*np.gradient(resample(a, s, dx, dy)))[40:-40, 60:-60].ravel()
                c = float(np.corrcoef(ga, gb)[0, 1])
                if c > best[0]:
                    best = (c, s, dx, dy)
    return best


def soften(img):
    k = np.array([1, 4, 6, 4, 1], np.float32)
    k /= k.sum()
    p = np.pad(img, ((2, 2), (2, 2), (0, 0)), mode='edge')
    h = sum(k[i] * p[:, i:i + img.shape[1]] for i in range(5))
    return sum(k[i] * h[i:i + img.shape[0]] for i in range(5))


def valid_mask(neutral, target):
    m = np.zeros(target.shape[:2], bool)
    m[24:-24, 36:-36] = True
    edges = np.hypot(*np.gradient(target.mean(-1)))
    return m & (edges < 0.03) & (neutral.max(-1) < 0.98) & (target.max(-1) < 0.995)


def fit_tone(x, y):
    lx = srgb_encode(x) @ LUMA
    ly = y @ LUMA
    edges = np.linspace(0, 1, 65)
    centers, values = [0.0], [0.0]
    for i in range(64):
        sel = (lx >= edges[i]) & (lx < edges[i + 1])
        if sel.sum() > 50:
            centers.append(float(np.median(lx[sel])))
            values.append(float(np.median(ly[sel])))
    centers.append(1.0)
    values.append(1.0)
    values = np.maximum.accumulate(np.array(values))
    return np.array(centers), values


def canonical(neutral, tone):
    base = srgb_encode(neutral)
    l = np.maximum(base @ LUMA, 1e-4)
    return np.clip(base * (np.interp(l, *tone) / l)[..., None], 0, 1)


def weights(x):
    g = np.clip(x, 0, 1) * (N - 1)
    i0 = np.clip(np.floor(g).astype(int), 0, N - 2)
    f = g - i0
    idx, w = [], []
    for corner in range(8):
        o = [(corner >> k) & 1 for k in range(3)]
        idx.append((i0[:, 0] + o[0]) * N * N + (i0[:, 1] + o[1]) * N + (i0[:, 2] + o[2]))
        w.append(np.prod([f[:, k] if o[k] else 1 - f[:, k] for k in range(3)], axis=0))
    return np.stack(idx, 1), np.stack(w, 1)


def read_prior(path):
    rows = []
    with open(path) as fh:
        for line in fh:
            parts = line.split()
            if len(parts) == 3 and parts[0][0] in '0123456789.-':
                rows.append([float(v) for v in parts])
    return np.array(rows).reshape(N, N, N, 3).transpose(2, 1, 0, 3).reshape(-1, 3)


def fit_lut(x, y, sample_weight, prior, smooth=20.0, prior_weight=5.0):
    idx, w = weights(x)
    w = w * sample_weight[:, None]
    k = N ** 3
    a = np.zeros((k, k))
    b = np.zeros((k, 3))
    for c1 in range(8):
        np.add.at(b, idx[:, c1], w[:, c1:c1 + 1] * y)
        for c2 in range(8):
            np.add.at(a, (idx[:, c1], idx[:, c2]), w[:, c1] * w[:, c2] / sample_weight)
    grid = np.arange(k).reshape(N, N, N)
    for axis in range(3):
        lo = np.take(grid, range(N - 1), axis=axis).ravel()
        hi = np.take(grid, range(1, N), axis=axis).ravel()
        np.add.at(a, (lo, lo), smooth)
        np.add.at(a, (hi, hi), smooth)
        np.add.at(a, (lo, hi), -smooth)
        np.add.at(a, (hi, lo), -smooth)
    a += prior_weight * np.eye(k)
    b += prior_weight * prior
    return np.clip(np.linalg.solve(a, b), 0, 1)


def apply_lut(lut, x):
    shape = x.shape
    idx, w = weights(x.reshape(-1, 3))
    return (lut[idx] * w[..., None]).sum(1).reshape(shape)


def robust_fit(frames, tone, rng, prior):
    xs, ys = [], []
    for f in frames:
        m = f['mask']
        xs.append(canonical(f['neutral'], tone)[m])
        ys.append(f['target'][m])
    x = np.concatenate(xs)
    y = np.concatenate(ys)
    sel = rng.choice(len(x), min(len(x), 400000), replace=False)
    x, y = x[sel], y[sel]
    weight = np.ones(len(x))
    lut = None
    for _ in range(3):
        lut = fit_lut(x, y, weight, prior)
        residual = delta_e2000(lab(apply_lut(lut, x)), lab(y))
        scale = max(float(np.median(residual)) * 2.0, 1.0)
        weight = np.where(residual <= scale, 1.0, scale / residual)
    return lut


def frame_scores(f, lut, tone):
    m = f['mask']
    ref = lab(f['target'])[m]
    base = canonical(f['neutral'], tone)
    fitted = apply_lut(lut, base)
    return {
        'canonical': float(delta_e2000(lab(base)[m], ref).mean()),
        'fitted': float(delta_e2000(lab(fitted)[m], ref).mean()),
        'fitted_p95': float(np.percentile(delta_e2000(lab(fitted)[m], ref), 95)),
    }


def summarize(rows, key):
    v = np.array([r[key] for r in rows]) if rows else np.array([np.nan])
    return {'mean': round(float(np.mean(v)), 2), 'median': round(float(np.median(v)), 2), 'n': len(rows)}


def coverage(frames):
    all_lab = np.concatenate([lab(f['target']).reshape(-1, 3) for f in frames])
    chroma = np.hypot(all_lab[:, 1], all_lab[:, 2])
    hue = np.degrees(np.arctan2(all_lab[:, 2], all_lab[:, 1])) % 360
    colored = chroma > 15
    bands = [('red', 345, 20), ('orange_skin', 20, 70), ('yellow', 70, 100), ('green', 100, 170),
             ('cyan', 170, 220), ('blue', 220, 290), ('magenta', 290, 345)]
    out = {}
    for name, lo, hi in bands:
        inside = (hue >= lo) & (hue < hi) if lo < hi else (hue >= lo) | (hue < hi)
        out[name] = round(float((colored & inside).mean() * 100), 2)
    return out


def write_lut(lut, out_dir, look, title):
    cube_order = lut.reshape(N, N, N, 3).transpose(2, 1, 0, 3).reshape(-1, 3)
    lines = [f'TITLE "{title}"', f'LUT_3D_SIZE {N}', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1']
    lines += [f'{r:.6f} {g:.6f} {b:.6f}' for r, g, b in cube_order]
    with open(os.path.join(out_dir, f'{look}.cube'), 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    words = np.round(np.clip(cube_order.ravel(), 0, 1) * 65535).astype('<u2')
    encoded = base64.b64encode(words.tobytes()).decode()
    with open(os.path.join(out_dir, f'{look}.mjs'), 'w') as fh:
        fh.write(f"export default {{size: {N}, data: '{encoded}'}};\n")


def contact_sheet(frames, rows, lut, tone, path):
    ordered = sorted(rows, key=lambda r: r['fitted'])
    picks = [ordered[0], ordered[len(ordered) // 2], ordered[-1]]
    by_name = {f['name']: f for f in frames}
    tiles = []
    for r in picks:
        f = by_name[r['name']]
        base = canonical(f['neutral'], tone)
        fitted = np.clip(apply_lut(lut, base), 0, 1)
        heat = np.clip(delta_e2000(lab(fitted), lab(f['target'])) / 10, 0, 1)
        heat_rgb = np.stack([heat, 0.15 + 0 * heat, 1 - heat], -1)
        tiles.append(np.concatenate([base, fitted, f['target'], heat_rgb], 1))
    Image.fromarray((np.concatenate(tiles, 0) * 255).astype(np.uint8)).save(path, quality=88)


def main():
    ap = argparse.ArgumentParser(description='Fit a look LUT from RAW files and their embedded in-camera previews.')
    ap.add_argument('--raws', required=True)
    ap.add_argument('--film-mode', required=True, help='exiftool FilmMode value to keep, e.g. "Classic Chrome"')
    ap.add_argument('--look', required=True, help='roll id, e.g. classic-chrome')
    ap.add_argument('--out', required=True, help='directory for <look>.cube and <look>.mjs')
    ap.add_argument('--prior', required=True, help='.cube of the parametric look (node tools/bake_prior.mjs), used where photos have no data')
    ap.add_argument('--report', required=True, help='directory for the report and decode cache (keep outside the repo)')
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    cache = os.path.join(args.report, 'pairs')
    os.makedirs(cache, exist_ok=True)
    meta = read_metadata(args.raws)
    keep = sorted(n for n, m in meta.items() if m.get('FilmMode') == args.film_mode)
    paths = [os.path.join(args.raws, n) for n in keep]
    with ProcessPoolExecutor(max(1, (os.cpu_count() or 2) - 1)) as ex:
        names = [n for n in ex.map(decode_pair, [(p, cache) for p in paths]) if n]

    frames, rejected = [], []
    for name in names:
        z = np.load(os.path.join(cache, name + '.npz'))
        info = meta.get(name + '.RAF', {})
        corr, s, dx, dy = align(z['neutral'], z['target'])
        if corr < 0.6:
            rejected.append({'name': name, 'reason': 'alignment', 'corr': round(corr, 3)})
            continue
        dr = str(info.get('AutoDynamicRange', '100%'))
        gain = {'200%': 2.0, '400%': 4.0}.get(dr, 1.0)
        neutral = soften(resample(z['neutral'], s, dx, dy) * gain)
        target = soften(z['target'])
        frames.append({'name': name, 'neutral': neutral, 'target': target, 'mask': valid_mask(neutral, target),
                       'dr': dr, 'iso': int(info.get('ISO', 0) or 0)})

    rng = np.random.default_rng(7)
    test = [f for i, f in enumerate(frames) if (i // 8) % 4 == 3]
    train = [f for i, f in enumerate(frames) if (i // 8) % 4 != 3]
    tone_x = np.concatenate([f['neutral'][f['mask']] for f in train])
    tone_y = np.concatenate([f['target'][f['mask']] for f in train])
    tone = fit_tone(tone_x, tone_y)
    prior = read_prior(args.prior)
    lut = robust_fit(train, tone, rng, prior)

    rows = []
    for f in test:
        rows.append({'name': f['name'], 'dr': f['dr'], 'iso': f['iso'], **frame_scores(f, lut, tone)})
    fitted = np.array([r['fitted'] for r in rows])
    med = float(np.median(fitted))
    mad = float(np.median(np.abs(fitted - med))) * 1.4826
    outliers = [r for r in rows if r['fitted'] > med + 3 * max(mad, 0.3)]
    inliers = [r for r in rows if r not in outliers]

    report = {
        'look': args.look,
        'film_mode': args.film_mode,
        'frames': {'decoded': len(names), 'used': len(frames), 'train': len(train), 'test': len(test)},
        'rejected': rejected,
        'heldout_delta_e': {
            'canonical_vs_camera': summarize(rows, 'canonical'),
            'fitted_vs_camera': summarize(rows, 'fitted'),
            'fitted_vs_camera_inliers': summarize(inliers, 'fitted'),
            'fitted_p95': summarize(rows, 'fitted_p95'),
        },
        'by_dynamic_range': {dr: summarize([r for r in rows if r['dr'] == dr], 'fitted') for dr in sorted({r['dr'] for r in rows})},
        'by_iso': {
            'iso<=800': summarize([r for r in rows if r['iso'] <= 800], 'fitted'),
            'iso>800': summarize([r for r in rows if r['iso'] > 800], 'fitted'),
        },
        'outliers': [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()} for r in outliers],
        'color_coverage_percent': coverage(frames),
        'tone_curve': {'x': [round(v, 4) for v in tone[0]], 'y': [round(v, 4) for v in tone[1]]},
    }
    contact_sheet(frames, rows, lut, tone, os.path.join(args.report, f'{args.look}-heldout.jpg'))

    outlier_names = {r['name'] for r in outliers}
    final = robust_fit([f for f in frames if f['name'] not in outlier_names], tone, rng, prior)
    write_lut(final, args.out, args.look, f'kiseki {args.look}')
    with open(os.path.join(args.report, f'{args.look}-report.json'), 'w') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(json.dumps({k: report[k] for k in ('frames', 'heldout_delta_e', 'by_dynamic_range', 'by_iso')}, ensure_ascii=False, indent=1))
    print('outliers:', [(r['name'], round(r['fitted'], 1)) for r in outliers])


if __name__ == '__main__':
    main()
