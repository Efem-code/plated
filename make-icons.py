"""Generate Plated's launcher icons: a plate and cutlery on paprika.

Pure stdlib — a small PNG encoder plus a scanline polygon filler. The scanline
approach matters: the obvious per-pixel point-in-polygon version takes minutes
for a 512x512 icon in Python, because it tests every subsample against every
edge. Computing the x-intersections once per scanline instead makes it instant.
"""
import zlib, struct, math

BG   = (0xc8, 0x55, 0x3d, 255)
MARK = (0xfb, 0xf4, 0xe8, 255)
SS   = 4                          # vertical subsamples per row

def box(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

def circle(cx, cy, r, n=96):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]

def ring(cx, cy, r0, r1, n=96):
    """An annulus as one polygon: outer circle, a seam, inner circle reversed.
    Even-odd span filling makes the seam cancel out."""
    outer = [(cx + r1 * math.cos(2 * math.pi * i / n), cy + r1 * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
    inner = [(cx + r0 * math.cos(2 * math.pi * i / n), cy + r0 * math.sin(2 * math.pi * i / n)) for i in range(n, -1, -1)]
    return outer + inner

def art(inset):
    """Returns (filled shapes, holes). Coordinates are 0..1: a plate seen from
    above with a fork on the left and a knife on the right."""
    def S(pts):
        return [(0.5 + (x - 0.5) * inset, 0.5 + (y - 0.5) * inset) for x, y in pts]
    plate = S(circle(0.5, 0.5, 0.27))
    groove = S(ring(0.5, 0.5, 0.19, 0.205))
    fork = [S(box(0.105, 0.42, 0.135, 0.76)), S(box(0.075, 0.33, 0.165, 0.43))]
    for x in (0.075, 0.107, 0.140):
        fork.append(S(box(x, 0.22, x + 0.025, 0.34)))
    knife = [S(box(0.865, 0.46, 0.895, 0.76)),
             S([(0.865, 0.22), (0.885, 0.22), (0.92, 0.30), (0.92, 0.47), (0.865, 0.47)])]
    return [plate] + fork + knife, [groove]

def spans(poly, y):
    """x-intervals where the horizontal line at `y` is inside `poly`."""
    xs = []
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    xs.sort()
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]

def add_span(cov, x0, x1, size):
    """Accumulate horizontal coverage with antialiased endpoints."""
    if x1 <= x0:
        return
    x0 = max(0.0, x0); x1 = min(float(size), x1)
    if x1 <= x0:
        return
    i0, i1 = int(x0), min(size - 1, int(x1 - 1e-9))
    if i0 == i1:
        cov[i0] += x1 - x0
        return
    cov[i0] += (i0 + 1) - x0
    for i in range(i0 + 1, i1):
        cov[i] += 1.0
    cov[i1] += x1 - i1

def rounded_bounds(y, size, r):
    """Left/right x of a rounded square at height y."""
    if r <= 0:
        return 0.0, float(size)
    if y < r:
        dy = r - y
    elif y > size - r:
        dy = y - (size - r)
    else:
        return 0.0, float(size)
    if dy >= r:
        return 0.0, 0.0
    dx = math.sqrt(r * r - dy * dy)
    return r - dx, size - r + dx

def render(size, radius_frac):
    shapes, holes = art(0.92)
    shapes = [[(x * size, y * size) for x, y in p] for p in shapes]
    holes  = [[(x * size, y * size) for x, y in p] for p in holes]
    r = radius_frac * size
    px = bytearray()

    for row in range(size):
        px.append(0)                                   # PNG filter byte: none
        bg   = [0.0] * size
        mark = [0.0] * size
        hole = [0.0] * size
        for s in range(SS):
            y = row + (s + 0.5) / SS
            lo, hi = rounded_bounds(y, size, r)
            add_span(bg, lo, hi, size)
            for poly in shapes:
                for a, b in spans(poly, y):
                    add_span(mark, a, b, size)
            for poly in holes:
                for a, b in spans(poly, y):
                    add_span(hole, a, b, size)
        for i in range(size):
            a_bg = min(1.0, bg[i] / SS)
            a_mk = min(1.0, mark[i] / SS) * (1.0 - min(1.0, hole[i] / SS))
            if a_bg <= 0:
                px.extend((0, 0, 0, 0))
                continue
            out = []
            for k in range(3):
                out.append(int(round(BG[k] * (1 - a_mk) + MARK[k] * a_mk)))
            out.append(int(round(255 * a_bg)))
            px.extend(bytes(out))
    return bytes(px)

def png(size, path, radius_frac):
    raw = render(size, radius_frac)
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    out = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    open(path, 'wb').write(out)
    print(path, '%dx%d' % (size, size), len(out), 'bytes')

png(192, 'icon-192.png', 0.22)
png(512, 'icon-512.png', 0.22)
png(512, 'icon-maskable.png', 0.5)    # full-bleed, safe under Android's crop
png(180, 'apple-touch-icon.png', 0.22)
