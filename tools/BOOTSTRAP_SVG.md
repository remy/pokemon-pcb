# SVG Bootstrap Tool

Use `tools/bootstrap_nets_svg.py` to generate starter net SVG paths from mask PNGs.

## Quick start

```bash
python tools/bootstrap_nets_svg.py --side front --output pm/front-nets.svg
python tools/bootstrap_nets_svg.py --side back --output pm/back-nets.svg
```

By default it auto-discovers:

- `pm/front-gnd.png`
- `pm/front-vcc.png`
- `pm/front-vbat.png`
- `pm/back-gnd.png`
- `pm/back-vcc.png`
- `pm/back-vbat.png`

It skips `front-nets.png` / `back-nets.png` unless `--include-nets-image` is set.

## Import into the editor

1. Open `editor.html`.
2. Pick `front` or `back`.
3. Click `Import side SVG` and choose the generated SVG.
4. Tidy points/curves and export.

## Useful flags

```bash
# Preview how many traced shapes would be produced
python tools/bootstrap_nets_svg.py --side front --dry-run

# Stronger simplification (fewer points)
python tools/bootstrap_nets_svg.py --side front --simplify 3.0 --max-points-per-shape 220

# Per-slug overrides
python tools/bootstrap_nets_svg.py --side front \
  --label gnd="Ground Plane" \
  --color gnd=#57d68d \
  --net-id gnd=front-gnd-main
```

