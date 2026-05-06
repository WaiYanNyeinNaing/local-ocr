#!/usr/bin/env python3
import argparse
import contextlib
import json
import sys
from pathlib import Path


LANG_ALIASES = {
    "ar": "ar",
    "ara": "ar",
    "arabic": "ar",
    "en": "en",
    "eng": "en",
    "english": "en",
}


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def import_paddleocr():
    with contextlib.redirect_stdout(sys.stderr):
        from paddleocr import PaddleOCR

    return PaddleOCR


def create_engine(lang):
    PaddleOCR = import_paddleocr()
    normalized_lang = LANG_ALIASES.get(lang.lower(), lang)

    with contextlib.redirect_stdout(sys.stderr):
        try:
            return PaddleOCR(
                lang=normalized_lang,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
        except Exception:
            try:
                return PaddleOCR(
                    use_angle_cls=False,
                    lang=normalized_lang,
                    use_gpu=False,
                    cpu_threads=2,
                    use_mp=False,
                    show_log=False,
                )
            except TypeError:
                return PaddleOCR(lang=normalized_lang)


def run_engine(engine, image_path):
    with contextlib.redirect_stdout(sys.stderr):
        if hasattr(engine, "predict"):
            return engine.predict(str(image_path))
        if hasattr(engine, "ocr"):
            try:
                return engine.ocr(str(image_path), cls=False)
            except TypeError:
                return engine.ocr(str(image_path))

    raise RuntimeError("PaddleOCR engine has neither ocr() nor predict()")


def flatten_legacy_result(result):
    if not result:
        return []

    if isinstance(result, list) and result and isinstance(result[0], list):
        first = result[0]
        if first and isinstance(first[0], list) and len(first[0]) == 2 and isinstance(first[0][1], tuple):
            return first

    if isinstance(result, list):
        return result

    return []


def normalize_points(points):
    normalized = []
    for point in points or []:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            normalized.append([float(point[0]), float(point[1])])
    return normalized


def bbox_from_points(points):
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return {
        "x1": min(xs),
        "y1": min(ys),
        "x2": max(xs),
        "y2": max(ys),
    }


def normalize_legacy_line(line):
    if not isinstance(line, (list, tuple)) or len(line) < 2:
        return None

    points = normalize_points(line[0])
    rec = line[1]
    if not isinstance(rec, (list, tuple)) or len(rec) < 2:
        return None

    text = str(rec[0]).strip()
    if not text:
        return None

    try:
        confidence = float(rec[1])
    except (TypeError, ValueError):
        confidence = None

    return {
        "text": text,
        "confidence": confidence,
        "points": points,
        "bbox": bbox_from_points(points),
    }


def normalize_predict_item(item):
    if hasattr(item, "json"):
        item = item.json
    if hasattr(item, "to_dict"):
        item = item.to_dict()

    if not isinstance(item, dict):
        return []

    if isinstance(item.get("res"), dict):
        item = item["res"]

    texts = item.get("rec_texts") or item.get("texts") or []
    scores = item.get("rec_scores") or item.get("scores") or []
    polys = item.get("rec_polys") or item.get("dt_polys") or item.get("polys") or []
    blocks = []

    for index, text in enumerate(texts):
        text = str(text).strip()
        if not text:
            continue

        points = normalize_points(polys[index] if index < len(polys) else [])
        score = scores[index] if index < len(scores) else None
        try:
            confidence = float(score) if score is not None else None
        except (TypeError, ValueError):
            confidence = None

        blocks.append({
            "text": text,
            "confidence": confidence,
            "points": points,
            "bbox": bbox_from_points(points),
        })

    return blocks


def normalize_result(result, lang):
    blocks = []

    for line in flatten_legacy_result(result):
        block = normalize_legacy_line(line)
        if block:
            blocks.append(block)

    if not blocks and isinstance(result, list):
        for item in result:
            blocks.extend(normalize_predict_item(item))

    for block in blocks:
        block["lang"] = lang

    return blocks


def sort_blocks(blocks):
    def key(block):
        bbox = block.get("bbox") or {}
        return (bbox.get("y1", 0), bbox.get("x1", 0), block.get("text", ""))

    return sorted(blocks, key=key)


def dedupe_blocks(blocks):
    seen = set()
    deduped = []
    for block in blocks:
        bbox = block.get("bbox") or {}
        signature = (
            block.get("lang"),
            block.get("text"),
            round(float(bbox.get("x1", 0)) / 4) if bbox else 0,
            round(float(bbox.get("y1", 0)) / 4) if bbox else 0,
        )
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(block)
    return deduped


def run_ocr(image_path, langs):
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    all_blocks = []
    passes = []

    for lang in langs:
        normalized_lang = LANG_ALIASES.get(lang.lower(), lang)
        try:
            print(f"[paddle_ocr] loading lang={normalized_lang}", file=sys.stderr, flush=True)
            engine = create_engine(normalized_lang)
            print(f"[paddle_ocr] running lang={normalized_lang}", file=sys.stderr, flush=True)
            result = run_engine(engine, image_path)
            blocks = normalize_result(result, normalized_lang)
            passes.append({"lang": normalized_lang, "ok": True, "block_count": len(blocks)})
            all_blocks.extend(blocks)
        except Exception as exc:
            passes.append({"lang": normalized_lang, "ok": False, "error": str(exc)})

    blocks = dedupe_blocks(sort_blocks(all_blocks))
    for index, block in enumerate(blocks):
        block["index"] = index

    return {
        "ok": any(pass_result.get("ok") for pass_result in passes),
        "image": str(image_path),
        "passes": passes,
        "block_count": len(blocks),
        "blocks": blocks,
        "plain_text": "\n".join(block["text"] for block in blocks),
    }


def health():
    PaddleOCR = import_paddleocr()
    return {
        "ok": True,
        "python": sys.version.split()[0],
        "paddleocr": getattr(PaddleOCR, "__module__", "paddleocr"),
    }


def main():
    parser = argparse.ArgumentParser(description="Run PaddleOCR and emit normalized JSON.")
    parser.add_argument("--health", action="store_true")
    parser.add_argument("--image")
    parser.add_argument("--langs", default="en,ar")
    args = parser.parse_args()

    try:
        if args.health:
            emit(health())
            return 0

        if not args.image:
            raise ValueError("--image is required unless --health is used")

        langs = [lang.strip() for lang in args.langs.split(",") if lang.strip()]
        emit(run_ocr(args.image, langs))
        return 0
    except Exception as exc:
        emit({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
