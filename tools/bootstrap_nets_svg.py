#!/usr/bin/env python3
import argparse
import math
import re
import subprocess
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

CANVAS_SIZE = 1765
KNOWN_CATEGORIES = ("signal", "gnd", "vcc", "vbat", "other")
DEFAULT_COLORS = {
    "signal": "#ffe05e",
    "gnd": "#68f2a0",
    "vcc": "#6ec5ff",
    "vbat": "#ff9d6e",
    "other": "#c8c8c8",
}


@dataclass
class SourceConfig:
    path: Path
    slug: str
    category: str
    color: str
    label: str
    net_id: str


def parse_assignments(raw_items: Sequence[str], arg_name: str) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for item in raw_items:
        if "=" not in item:
            raise SystemExit(f"{arg_name}: expected key=value, got '{item}'")
        key, value = item.split("=", 1)
        key = key.strip().lower()
        value = value.strip()
        if not key or not value:
            raise SystemExit(f"{arg_name}: expected key=value, got '{item}'")
        mapping[key] = value
    return mapping


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text or "net"


def infer_slug(side: str, stem: str) -> str:
    prefix = f"{side}-"
    if stem.startswith(prefix):
        return slugify(stem[len(prefix):])
    return slugify(stem)


def infer_category(slug: str) -> str:
    parts = slug.split("-")
    for part in parts:
        if part in KNOWN_CATEGORIES:
            return part
    return "signal"


def parse_source_descriptor(descriptor: str, side: str) -> Tuple[Path, str]:
    if ":" in descriptor:
        source_path, alias = descriptor.split(":", 1)
        return Path(source_path), slugify(alias)
    source_path = Path(descriptor)
    return source_path, infer_slug(side, source_path.stem)


def discover_sources(
    side: str,
    input_dir: Path,
    explicit_sources: Sequence[str],
    include_nets_image: bool,
) -> List[Tuple[Path, str]]:
    if explicit_sources:
        found = [parse_source_descriptor(item, side) for item in explicit_sources]
        missing = [str(path) for path, _ in found if not path.exists()]
        if missing:
            raise SystemExit(f"Missing source image(s): {', '.join(missing)}")
        return found

    pattern = f"{side}-*.png"
    candidates = sorted(input_dir.glob(pattern))
    if not include_nets_image:
        candidates = [path for path in candidates if path.name != f"{side}-nets.png"]
    if not candidates:
        raise SystemExit(f"No source PNGs found for side '{side}' in {input_dir}")
    return [(path, infer_slug(side, path.stem)) for path in candidates]


def load_binary_mask(path: Path, alpha_threshold: int) -> Tuple[int, int, bytearray]:
    threshold_pct = max(0.0, min(100.0, (alpha_threshold / 255.0) * 100.0))
    command = [
        "magick",
        str(path),
        "-alpha",
        "extract",
        "-threshold",
        f"{threshold_pct:.6f}%",
        "-compress",
        "none",
        "pgm:-",
    ]

    try:
        result = subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as error:
        stderr = error.stderr.decode("utf-8", "replace").strip()
        raise SystemExit(f"Failed to rasterize mask from {path}: {stderr or error}") from error

    width, height, gray = parse_pgm(result.stdout)
    mask = bytearray(1 if value > 0 else 0 for value in gray)
    return width, height, mask


def parse_pgm(payload: bytes) -> Tuple[int, int, bytes]:
    index = 0
    length = len(payload)

    def skip_ws_and_comments(position: int) -> int:
        while position < length:
            byte = payload[position]
            if byte in b" \t\r\n":
                position += 1
                continue
            if byte == ord("#"):
                while position < length and payload[position] not in b"\r\n":
                    position += 1
                continue
            break
        return position

    def next_token(position: int) -> Tuple[bytes, int]:
        position = skip_ws_and_comments(position)
        start = position
        while position < length and payload[position] not in b" \t\r\n#":
            position += 1
        if start == position:
            raise ValueError("Unexpected end of PGM header")
        return payload[start:position], position

    magic, index = next_token(index)
    if magic not in (b"P5", b"P2"):
        raise ValueError(f"Expected P5/P2 PGM, got {magic!r}")

    width_raw, index = next_token(index)
    height_raw, index = next_token(index)
    maxval_raw, index = next_token(index)

    width = int(width_raw)
    height = int(height_raw)
    maxval = int(maxval_raw)
    if maxval <= 0 or maxval > 255:
        raise ValueError("Only 8-bit PGM is supported")

    expected = width * height

    if magic == b"P5":
        index = skip_ws_and_comments(index)
        body = payload[index:index + expected]
        if len(body) != expected:
            raise ValueError("PGM payload is truncated")
        return width, height, body

    values = bytearray()
    for _ in range(expected):
        token, index = next_token(index)
        raw = int(token)
        if raw < 0:
            raw = 0
        if raw > maxval:
            raw = maxval
        value = int(round((raw / maxval) * 255)) if maxval != 255 else raw
        values.append(value)

    return width, height, bytes(values)


def connected_components(mask: bytearray, width: int, height: int, min_area: int) -> List[List[int]]:
    visited = bytearray(width * height)
    components: List[List[int]] = []

    for start in range(width * height):
        if not mask[start] or visited[start]:
            continue

        queue = deque([start])
        visited[start] = 1
        pixels: List[int] = []

        while queue:
            idx = queue.popleft()
            pixels.append(idx)
            x = idx % width
            y = idx // width

            if x > 0:
                left = idx - 1
                if mask[left] and not visited[left]:
                    visited[left] = 1
                    queue.append(left)
            if x < width - 1:
                right = idx + 1
                if mask[right] and not visited[right]:
                    visited[right] = 1
                    queue.append(right)
            if y > 0:
                up = idx - width
                if mask[up] and not visited[up]:
                    visited[up] = 1
                    queue.append(up)
            if y < height - 1:
                down = idx + width
                if mask[down] and not visited[down]:
                    visited[down] = 1
                    queue.append(down)

        if len(pixels) >= min_area:
            components.append(pixels)

    return components


def polygon_area(points: Sequence[Tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return area * 0.5


def trace_component_loops(
    pixels: Sequence[int],
    mask: bytearray,
    width: int,
    height: int,
) -> List[List[Tuple[float, float]]]:
    edges: Dict[Tuple[int, int], List[Tuple[int, int]]] = defaultdict(list)

    for idx in pixels:
        x = idx % width
        y = idx // width

        if y == 0 or not mask[idx - width]:
            edges[(x, y)].append((x + 1, y))
        if x == width - 1 or not mask[idx + 1]:
            edges[(x + 1, y)].append((x + 1, y + 1))
        if y == height - 1 or not mask[idx + width]:
            edges[(x + 1, y + 1)].append((x, y + 1))
        if x == 0 or not mask[idx - 1]:
            edges[(x, y + 1)].append((x, y))

    loops: List[List[Tuple[float, float]]] = []
    while edges:
        start = next(iter(edges))
        current = start
        loop: List[Tuple[float, float]] = [start]
        guard = 0
        max_steps = len(pixels) * 6 + 32

        while True:
            neighbors = edges.get(current)
            if not neighbors:
                break

            nxt = neighbors.pop()
            if not neighbors:
                del edges[current]

            current = nxt
            if current == start:
                break

            loop.append(current)
            guard += 1
            if guard > max_steps:
                break

        if len(loop) >= 3 and polygon_area(loop) > 0:
            loops.append(loop)

    return loops


def remove_collinear(points: Sequence[Tuple[float, float]]) -> List[Tuple[float, float]]:
    if len(points) < 4:
        return list(points)
    out: List[Tuple[float, float]] = []
    n = len(points)
    for i in range(n):
        prev = points[(i - 1) % n]
        cur = points[i]
        nxt = points[(i + 1) % n]
        if (prev[0] == cur[0] == nxt[0]) or (prev[1] == cur[1] == nxt[1]):
            continue
        out.append(cur)
    return out if len(out) >= 3 else list(points)


def point_to_segment_distance(point, start, end) -> float:
    px, py = point
    ax, ay = start
    bx, by = end
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    denom = abx * abx + aby * aby
    if denom <= 1e-12:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, (apx * abx + apy * aby) / denom))
    cx = ax + abx * t
    cy = ay + aby * t
    return math.hypot(px - cx, py - cy)


def simplify_rdp_open(points: Sequence[Tuple[float, float]], epsilon: float) -> List[Tuple[float, float]]:
    if len(points) < 3 or epsilon <= 0:
        return list(points)

    keep = [False] * len(points)
    keep[0] = True
    keep[-1] = True
    stack: List[Tuple[int, int]] = [(0, len(points) - 1)]

    while stack:
        start_idx, end_idx = stack.pop()
        start = points[start_idx]
        end = points[end_idx]
        max_distance = -1.0
        max_index = -1

        for idx in range(start_idx + 1, end_idx):
            distance = point_to_segment_distance(points[idx], start, end)
            if distance > max_distance:
                max_distance = distance
                max_index = idx

        if max_index >= 0 and max_distance > epsilon:
            keep[max_index] = True
            stack.append((start_idx, max_index))
            stack.append((max_index, end_idx))

    return [point for point, keep_point in zip(points, keep) if keep_point]


def simplify_closed(points: Sequence[Tuple[float, float]], epsilon: float) -> List[Tuple[float, float]]:
    if len(points) < 4 or epsilon <= 0:
        return list(points)
    ring = list(points) + [points[0]]
    simplified = simplify_rdp_open(ring, epsilon)
    if len(simplified) > 1 and simplified[0] == simplified[-1]:
        simplified = simplified[:-1]
    return simplified if len(simplified) >= 3 else list(points)


def decimate(points: Sequence[Tuple[float, float]], max_points: int) -> List[Tuple[float, float]]:
    if max_points <= 0 or len(points) <= max_points:
        return list(points)
    stride = int(math.ceil(len(points) / max_points))
    sampled = [points[i] for i in range(0, len(points), stride)]
    if len(sampled) < 3:
        return list(points[:3])
    return sampled


def serialize_points(points: Sequence[Tuple[float, float]]) -> str:
    return ";".join(f"{x:.2f},{y:.2f}" for x, y in points)


def serialize_point_modes(count: int) -> str:
    if count <= 0:
        return ""
    return ";".join("c" for _ in range(count))


def points_to_path_d(points: Sequence[Tuple[float, float]]) -> str:
    if len(points) < 3:
        return ""
    parts = [f"M {points[0][0]:.2f} {points[0][1]:.2f}"]
    for x, y in points[1:]:
        parts.append(f"L {x:.2f} {y:.2f}")
    parts.append("Z")
    return " ".join(parts)


def escape_xml(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def build_source_configs(
    side: str,
    discovered: Sequence[Tuple[Path, str]],
    category_overrides: Dict[str, str],
    color_overrides: Dict[str, str],
    label_overrides: Dict[str, str],
    net_id_overrides: Dict[str, str],
) -> List[SourceConfig]:
    configs: List[SourceConfig] = []
    for path, slug in discovered:
        category = category_overrides.get(slug, infer_category(slug))
        if category not in KNOWN_CATEGORIES:
            category = "other"
        color = color_overrides.get(slug) or color_overrides.get(category) or DEFAULT_COLORS[category]
        label = label_overrides.get(slug) or slug.replace("-", " ").upper()
        net_id = net_id_overrides.get(slug) or f"{side}-{slug}"
        configs.append(
            SourceConfig(
                path=path,
                slug=slug,
                category=category,
                color=color,
                label=label,
                net_id=slugify(net_id),
            )
        )
    return configs


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bootstrap editable PCB net SVG paths from alpha-mask PNG files."
    )
    parser.add_argument("--side", choices=("front", "back"), required=True)
    parser.add_argument("--input-dir", default="pm", help="Folder containing side mask PNGs.")
    parser.add_argument(
        "--source",
        action="append",
        default=[],
        help="Explicit source PNG or source PNG with alias: path/to/file.png[:slug]",
    )
    parser.add_argument(
        "--include-nets-image",
        action="store_true",
        help="Include <side>-nets.png when auto-discovering source masks.",
    )
    parser.add_argument(
        "--output",
        help="Output SVG path. Defaults to <input-dir>/<side>-nets.svg",
    )
    parser.add_argument("--alpha-threshold", type=int, default=22, help="Alpha threshold (0-255).")
    parser.add_argument("--min-area", type=int, default=24, help="Ignore components smaller than this.")
    parser.add_argument("--simplify", type=float, default=2.2, help="RDP simplify epsilon in pixels.")
    parser.add_argument(
        "--max-points-per-shape",
        type=int,
        default=320,
        help="Hard cap of anchor count per generated path.",
    )
    parser.add_argument(
        "--category",
        action="append",
        default=[],
        help="Override category by slug: slug=signal|gnd|vcc|vbat|other",
    )
    parser.add_argument(
        "--color",
        action="append",
        default=[],
        help="Override color by slug or category: gnd=#68f2a0",
    )
    parser.add_argument(
        "--label",
        action="append",
        default=[],
        help="Override legend label by slug: gnd=Ground Plane",
    )
    parser.add_argument(
        "--net-id",
        action="append",
        default=[],
        help="Override net id by slug: gnd=front-gnd-main",
    )
    parser.add_argument(
        "--split-components",
        action="store_true",
        help="Emit one net-id per connected component instead of sharing one per source image.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print summary only, do not write SVG.")

    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output = Path(args.output) if args.output else input_dir / f"{args.side}-nets.svg"

    category_overrides = parse_assignments(args.category, "--category")
    color_overrides = parse_assignments(args.color, "--color")
    label_overrides = parse_assignments(args.label, "--label")
    net_id_overrides = parse_assignments(args.net_id, "--net-id")

    discovered = discover_sources(
        side=args.side,
        input_dir=input_dir,
        explicit_sources=args.source,
        include_nets_image=args.include_nets_image,
    )
    configs = build_source_configs(
        side=args.side,
        discovered=discovered,
        category_overrides=category_overrides,
        color_overrides=color_overrides,
        label_overrides=label_overrides,
        net_id_overrides=net_id_overrides,
    )

    all_rows: List[str] = []
    total_shapes = 0
    total_sources = 0
    image_size: Tuple[int, int] = (CANVAS_SIZE, CANVAS_SIZE)

    for source in configs:
        width, height, mask = load_binary_mask(source.path, args.alpha_threshold)
        image_size = (width, height)
        components = connected_components(mask, width, height, args.min_area)

        shape_count = 0
        component_index = 0
        for pixels in components:
            loops = trace_component_loops(pixels, mask, width, height)
            for loop in loops:
                clean = remove_collinear(loop)
                simplified = simplify_closed(clean, args.simplify)
                simplified = decimate(simplified, args.max_points_per_shape)
                if len(simplified) < 3:
                    continue

                component_index += 1
                shape_count += 1
                net_id = source.net_id
                net_label = source.label
                if args.split_components:
                    net_id = f"{source.net_id}-{component_index:03d}"
                    net_label = f"{source.label} {component_index:03d}"

                d = points_to_path_d(simplified)
                point_str = serialize_points(simplified)
                point_modes = serialize_point_modes(len(simplified))
                row = (
                    f'  <path d="{escape_xml(d)}" '
                    f'data-net-id="{escape_xml(net_id)}" '
                    f'data-net-label="{escape_xml(net_label)}" '
                    f'data-category="{escape_xml(source.category)}" '
                    f'data-color="{escape_xml(source.color)}" '
                    f'data-stroke-width="1" '
                    f'fill="{escape_xml(source.color)}" fill-opacity="1" '
                    f'data-editor-points="{escape_xml(point_str)}" '
                    f'data-editor-point-modes="{escape_xml(point_modes)}" />'
                )
                all_rows.append(row)

        total_sources += 1
        total_shapes += shape_count
        print(
            f"{source.path.name}: {shape_count} shape(s), net-id='{source.net_id}', "
            f"label='{source.label}', category='{source.category}'"
        )

    print(f"Total sources: {total_sources}")
    print(f"Total shapes: {total_shapes}")

    if args.dry_run:
        return 0

    width, height = image_size
    body = "\n".join(all_rows)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">\n'
        f"{body}\n"
        "</svg>\n"
    )
    output.write_text(svg, encoding="utf-8")
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
