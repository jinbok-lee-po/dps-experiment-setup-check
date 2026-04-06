#!/usr/bin/env python3
"""
Resize an image to a target width in pixels while preserving aspect ratio.

Usage:
  python resize_image.py <image_path> <width_px> [--output PATH]

Example (프로젝트 루트에 둔 `image_example.jpeg`):
  python resize_image.py image_example.jpeg 400

If --output is omitted, writes next to the input as: <stem>_w<width><suffix>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image


def compute_size(orig_w: int, orig_h: int, target_w: int) -> tuple[int, int]:
    if orig_w <= 0 or orig_h <= 0:
        raise ValueError("Invalid original dimensions")
    if target_w <= 0:
        raise ValueError("Target width must be a positive integer")
    new_h = max(1, round(orig_h * (target_w / orig_w)))
    return target_w, new_h


def default_output_path(input_path: Path, width: int) -> Path:
    return input_path.with_name(f"{input_path.stem}_w{width}{input_path.suffix}")


def _resolve_existing_image(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    if resolved.is_dir():
        raise FileNotFoundError(
            f"폴더 경로가 전달되었습니다. 이미지 파일을 지정하세요: {resolved}"
        )
    if not resolved.exists():
        raise FileNotFoundError(
            "입력 파일이 없습니다.\n"
            f"  경로: {resolved}\n"
            "  프로젝트에 두신 `image_example.jpeg`로 시험하거나, "
            "실제 이미지의 올바른 경로를 넣어 주세요."
        )
    if not resolved.is_file():
        raise FileNotFoundError(f"일반 파일이 아닙니다: {resolved}")
    return resolved


def resize_image(input_path: Path, target_width: int, output_path: Path | None) -> Path:
    input_path = _resolve_existing_image(input_path)

    out = (
        output_path.expanduser().resolve()
        if output_path
        else default_output_path(input_path, target_width)
    )
    out.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(input_path) as im:
        im = im.convert("RGBA") if im.mode in ("P", "PA") and "transparency" in im.info else im
        w, h = im.size
        new_w, new_h = compute_size(w, h, target_width)
        if (new_w, new_h) == (w, h):
            im.save(out)
            return out
        resampled = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
        # Keep original mode when possible for formats that care (e.g. JPEG no alpha)
        if resampled.mode == "RGBA" and out.suffix.lower() in {".jpg", ".jpeg"}:
            resampled = resampled.convert("RGB")
        resampled.save(out)

    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Resize image to target width (aspect ratio preserved).")
    parser.add_argument("image_path", type=Path, help="Path to input image")
    parser.add_argument("width_px", type=int, help="Target width in pixels")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output file path (default: <input_stem>_w<width><suffix> next to input)",
    )
    args = parser.parse_args()

    try:
        out = resize_image(args.image_path, args.width_px, args.output)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
