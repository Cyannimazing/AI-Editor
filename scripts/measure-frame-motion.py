"""Read-only local landmark measurement. No media uploads or model downloads."""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import cv2 as cv
import numpy as np

cv.setNumThreads(1)
cv.setRNGSeed(0)


def picture_bounds(image):
    """Conservative edge-matte estimate, not a subject bounding box.

    Require near-black pixels across nearly the entire row/column. Dark scenes
    are indeterminate, and isolated internal black regions are never cropped.
    Coordinates are normalized so downscaled evidence retains the same meaning.
    """
    lit = image > 12
    rows = np.flatnonzero(lit.mean(axis=1) > 0.02)
    cols = np.flatnonzero(lit.mean(axis=0) > 0.02)
    if not len(rows) or not len(cols) or lit.mean() < 0.08:
        return None
    h, w = image.shape
    return {"left": float(cols[0] / w), "top": float(rows[0] / h),
            "right": float((cols[-1] + 1) / w), "bottom": float((rows[-1] + 1) / h)}


def coverage(source, reference, matrix):
    # Compare actual active-picture pixels, excluding existing mattes. A good
    # landmark fit can still require pixels absent from the source frame.
    bounds = picture_bounds(source)
    h, w = reference.shape
    if bounds is None:
        return None
    mask = np.zeros(source.shape, np.uint8)
    x0, y0, x1, y1 = [round(bounds[k] * size) for k, size in
                       [("left", source.shape[1]), ("top", source.shape[0]),
                        ("right", source.shape[1]), ("bottom", source.shape[0])]]
    mask[y0:y1, x0:x1] = 255
    support = cv.warpAffine(mask, matrix, (w, h), flags=cv.INTER_NEAREST)
    visible = reference > 24
    if visible.mean() < 0.08:
        return None
    return round(float(np.count_nonzero(visible & (support == 0)) / np.count_nonzero(visible)), 5)


def compare_pixels(reference, candidate):
    """Detect added edge gaps from pixels, independently of planner/reviewer claims."""
    h, w = reference.shape
    candidate = cv.resize(candidate, (w, h), interpolation=cv.INTER_AREA)
    bounds = picture_bounds(candidate)
    if bounds is None:
        if (reference > 24).mean() > 0.15:
            return {"addedEdgeGapFraction": 1.0, "referenceBounds": picture_bounds(reference), "candidateBounds": None}
        return {"addedEdgeGapFraction": 0.0, "referenceBounds": picture_bounds(reference), "candidateBounds": None}
    # An overlay can reach the upper edge while the video below is shrunken.
    # Use edge-connected black regions, not a union bounding box of all layers.
    _, labels = cv.connectedComponents((candidate <= 12).astype(np.uint8), connectivity=4)
    edge_labels = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    edge_black = np.isin(labels, edge_labels[edge_labels != 0])
    visible = reference > 24
    gap = float(np.count_nonzero(visible & edge_black) / max(1, np.count_nonzero(visible)))
    reference_bounds = picture_bounds(reference)
    spill = 0.0
    if reference_bounds:
        allowed = np.zeros((h, w), np.uint8)
        x0, y0, x1, y1 = [round(reference_bounds[k] * size) for k, size in
                           [("left", w), ("top", h), ("right", w), ("bottom", h)]]
        allowed[y0:y1, x0:x1] = 1
        spill = float(np.count_nonzero((candidate > 24) & (allowed == 0)) / max(1, np.count_nonzero(visible)))
    return {"addedEdgeGapFraction": round(gap, 5), "pictureSpillFraction": round(spill, 5),
            "referenceBounds": reference_bounds, "candidateBounds": bounds}


def corroborate_gap(pixels, geometry):
    raw = pixels["addedEdgeGapFraction"]
    blank = pixels["candidateBounds"] is None and pixels["referenceBounds"] is not None
    return {**pixels, "darkEdgeDifferenceFraction": raw, "geometryCorroborated": geometry is not None,
            "addedEdgeGapFraction": raw if blank else min(raw, geometry["uncoveredFraction"]) if geometry else 0}


def frame(path, root):
    path = Path(path)
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError("Frame escapes its job")
    data = path.read_bytes()
    if len(data) > 20 * 1024 * 1024:
        raise ValueError("Frame exceeds measurement budget")
    image = cv.imdecode(np.frombuffer(data, np.uint8), cv.IMREAD_GRAYSCALE)
    if image is None or image.size > 34_000_000:
        raise ValueError("Invalid measurement frame")
    height, width = image.shape
    ratio = min(1, 720 / max(width, height))
    image = cv.resize(image, (round(width * ratio), round(height * ratio)), interpolation=cv.INTER_AREA)
    return image, hashlib.sha256(data).hexdigest()


def register(source, reference):
    """Estimate source -> reference similarity only when widespread landmarks agree."""
    h, w = reference.shape
    sh, sw = source.shape
    if abs(sw / sh - w / h) > 0.01:
        return {"status": "unmatched", "reason": "Different canvas aspect ratios require an explicit crop mapping."}
    source = cv.resize(source, (w, h), interpolation=cv.INTER_AREA)
    detector = cv.SIFT_create(nfeatures=1800)
    a, ad = detector.detectAndCompute(source, None)
    b, bd = detector.detectAndCompute(reference, None)
    if ad is None or bd is None or min(len(a), len(b)) < 20:
        return {"status": "unmatched", "reason": "Insufficient distinctive landmarks."}
    forward = cv.BFMatcher().knnMatch(ad, bd, k=2)
    reverse = cv.BFMatcher().knnMatch(bd, ad, k=2)
    back = {m.queryIdx: m.trainIdx for pair in reverse if len(pair) == 2 for m, n in [pair] if m.distance < 0.72 * n.distance}
    good = [m for pair in forward if len(pair) == 2 for m, n in [pair] if m.distance < 0.72 * n.distance and back.get(m.trainIdx) == m.queryIdx]
    if len(good) < 20:
        return {"status": "unmatched", "reason": "No reliable shared footage landmarks."}
    p = np.float32([a[m.queryIdx].pt for m in good])
    q = np.float32([b[m.trainIdx].pt for m in good])
    matrix, mask = cv.estimateAffinePartial2D(p, q, method=cv.RANSAC, ransacReprojThreshold=2, maxIters=3000, confidence=0.999, refineIters=20)
    if matrix is None:
        return {"status": "unmatched", "reason": "Landmarks do not support one source transform."}
    accepted = mask.ravel().astype(bool)
    count = int(accepted.sum())
    residual = np.linalg.norm(p @ matrix[:, :2].T + matrix[:, 2] - q, axis=1)
    spread = np.ptp(p[accepted], axis=0) / [w, h]
    hull_area = cv.contourArea(cv.convexHull(p[accepted])) / (w * h)
    scale = float(math.hypot(matrix[0, 0], matrix[1, 0]))
    rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    center = matrix @ np.array([w / 2, h / 2, 1])
    metrics = {"inliers": count, "matches": len(good), "inlierRatio": round(count / len(good), 4),
               "medianResidualPx": round(float(np.median(residual[accepted])), 4), "landmarkCoverage": round(hull_area, 4)}
    # Small foreground-only fits and unrelated scenes must not drive source keyframes.
    if count < 20 or count / len(good) < 0.65 or min(spread) < 0.35 or hull_area < 0.12 or metrics["medianResidualPx"] > 1.5 or not 0.5 <= scale <= 2 or abs(rotation) > 30:
        return {"status": "unmatched", "reason": "Insufficient agreement across the picture.", **metrics}
    uncovered = coverage(source, reference, matrix)
    return {"status": "matched", **metrics, "uncoveredReferenceFraction": uncovered,
            "directlyApplicable": uncovered is not None and uncovered <= 0.015,
            "transform": {"scale": round(scale, 5),
            "x": round(float((center[0] - w / 2) * 2 / w), 5),
            "y": round(float(-(center[1] - h / 2) * 2 / h), 5), "rotation": round(rotation, 4)}}


def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    root = Path(request["job"]).resolve(strict=True)
    if not 1 <= len(request["pairs"]) <= 120:
        raise ValueError("Invalid frame count")
    if request.get("mode") == "audit":
        samples = []
        # Dark hair/shadows touching an edge are not empty canvas. Corroborate
        # pixel evidence with the independently serialized source geometry.
        # Keep the raw pixel statistic visible; never relabel it a verified gap.
        stem = Path(sys.argv[1]).stem
        round_number = stem.removeprefix("motion-audit-request-")
        geometry = []
        geometry_file = request.get("geometryFile", f"motion-curves-{round_number}.json")
        if re.fullmatch(r"motion-curves-[1-4](?:-recheck)?\.json", geometry_file):
            receipt = root / geometry_file
            if receipt.is_file() and not receipt.is_symlink() and receipt.resolve().is_relative_to(root):
                geometry = json.loads(receipt.read_text(encoding="utf-8")).get("sourceCoverage", [])
        for pair in request["pairs"]:
            reference, rh = frame(pair["reference"], root)
            candidate, ch = frame(pair["preview"], root)
            measured = compare_pixels(reference, candidate)
            bounds_check = next((item for item in geometry if abs(item["time"] - pair["time"]) < 0.0001), None)
            measured = corroborate_gap(measured, bounds_check)
            samples.append({"time": pair["time"], "referenceSha256": rh, "candidateSha256": ch,
                            **measured})
        print(json.dumps({"version": 1, "kind": "rendered-frame-coverage", "nativeVerified": False, "samples": samples,
                          "method": "Edge pixels corroborated with serialized source picture geometry. darkEdgeDifferenceFraction alone can include hair or shadows and is NOT an empty-space defect. Only addedEdgeGapFraction reports corroborated gaps; pictureSpillFraction reports content outside reference mattes."}))
        return
    if request.get("mode") == "comparison":
        images = []
        for index, pair in enumerate(request["pairs"]):
            panels = []
            for label, key in [("REFERENCE", "reference"), ("SOURCE", "source"), ("CANDIDATE PREVIEW", "preview")]:
                path = Path(pair[key])
                frame(path, root)  # Apply the same file/decode budget before color rendering.
                picture = cv.imdecode(np.frombuffer(path.read_bytes(), np.uint8), cv.IMREAD_COLOR)
                h, w = picture.shape[:2]
                factor = min(360 / w, 780 / h)
                picture = cv.resize(picture, (round(w * factor), round(h * factor)), interpolation=cv.INTER_AREA)
                panel = np.zeros((824, 360, 3), np.uint8)
                ph, pw = picture.shape[:2]
                panel[44:44 + ph, (360 - pw) // 2:(360 - pw) // 2 + pw] = picture
                cv.putText(panel, f"{label}  {pair[key + 'Time']:.4f}s", (6, 26), cv.FONT_HERSHEY_SIMPLEX, 0.49, (255, 255, 255), 1, cv.LINE_AA)
                panels.append(panel)
            destination = root / request["outputFolder"] / f"comparison-{index:02}.png"
            if not destination.resolve().is_relative_to(root):
                raise ValueError("Comparison destination escapes job")
            destination.parent.mkdir(parents=True, exist_ok=True)
            ok, encoded = cv.imencode('.png', np.hstack(panels))
            if not ok:
                raise ValueError("Comparison encoding failed")
            destination.write_bytes(encoded.tobytes())
            images.append({"path": str(destination), "time": pair["time"]})
        print(json.dumps({"version": 1, "images": images, "layout": "Reference | unedited source | approximate candidate; timestamps are printed on each panel. Full canvas, same scale, no content crop."}))
        return
    samples = []
    for pair in request["pairs"]:
        source, source_hash = frame(pair["source"], root)
        reference, reference_hash = frame(pair["reference"], root)
        samples.append({"time": pair["time"], "sourceTime": pair["sourceTime"],
                        "sourceBounds": picture_bounds(source), "referenceBounds": picture_bounds(reference),
                        "sourceSha256": source_hash, "referenceSha256": reference_hash, **register(source, reference)})
    print(json.dumps({"version": 1, "method": "SIFT mutual matches + RANSAC similarity, full-frame coordinates",
                      "nativeVerified": False, "samples": samples,
                      "limitations": ["Same-time shared footage only; not a retiming, object tracking or optical-effect verification.",
                                      "Unmatched samples supply no transform; do not guess missing motion."]}))


if __name__ == "__main__":
    main()
