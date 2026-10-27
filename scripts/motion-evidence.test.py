"""Synthetic ground truth, never mutate a personal project or need online services."""
import importlib.util
from pathlib import Path
import unittest

import cv2 as cv
import numpy as np

spec = importlib.util.spec_from_file_location('frame_motion', Path(__file__).with_name('measure-frame-motion.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def texture(seed):
    rng = np.random.default_rng(seed)
    image = np.full((640, 480), 32, np.uint8)
    for _ in range(200):
        x, y = rng.integers(20, 460), rng.integers(20, 620)
        cv.circle(image, (int(x), int(y)), int(rng.integers(3, 15)), int(rng.integers(60, 250)), -1)
    return image


class FrameMotionTest(unittest.TestCase):
    def test_measured_zoom_translation_rotation_survive_a_foreground_overlay(self):
        source = texture(123)
        matrix = cv.getRotationMatrix2D((240, 320), -4, 0.83)
        matrix[:, 2] += [31, -18]
        target = cv.warpAffine(source, matrix, (480, 640))
        cv.rectangle(target, (100, 70), (310, 170), 255, -1)
        result = module.register(source, target)
        self.assertEqual(result['status'], 'matched')
        self.assertAlmostEqual(result['transform']['scale'], 0.83, delta=0.004)
        self.assertAlmostEqual(result['transform']['x'], 31 / 240, delta=0.004)
        self.assertAlmostEqual(result['transform']['y'], 18 / 320, delta=0.004)
        self.assertAlmostEqual(result['transform']['rotation'], 4, delta=0.2)

    def test_unrelated_flat_and_different_aspect_frames_have_no_suggested_motion(self):
        for a, b in [(texture(12), texture(98)), (np.zeros((640, 480), np.uint8), texture(12)), (texture(12), np.zeros((480, 640), np.uint8))]:
            result = module.register(a, b)
            self.assertEqual(result['status'], 'unmatched')
            self.assertNotIn('transform', result)

    def test_landmark_fit_does_not_authorize_shrinking_into_missing_picture(self):
        source = texture(123)
        matrix = cv.getRotationMatrix2D((240, 320), 0, 0.8)
        # The reference has picture outside the part explained by this source.
        target = cv.warpAffine(source, matrix, (480, 640), borderMode=cv.BORDER_REFLECT)
        result = module.register(source, target)
        self.assertEqual(result['status'], 'matched')
        self.assertFalse(result['directlyApplicable'])
        self.assertGreater(result['uncoveredReferenceFraction'], 0.2)

    def test_existing_mattes_are_not_extra_gaps_but_shrunk_video_is(self):
        reference = np.zeros((640, 480), np.uint8)
        reference[60:580] = 160
        self.assertEqual(module.compare_pixels(reference, reference)['addedEdgeGapFraction'], 0)
        candidate = np.zeros_like(reference)
        candidate[120:520, 60:420] = 160
        # Floating art reaches the top; it must not hide the source's black gaps.
        cv.circle(candidate, (350, 55), 50, 255, -1)
        self.assertGreater(module.compare_pixels(reference, candidate)['addedEdgeGapFraction'], 0.3)
        self.assertGreater(module.compare_pixels(reference, candidate)['pictureSpillFraction'], 0.01)
        self.assertIsNone(module.picture_bounds(np.zeros_like(reference)))

    def test_edge_shadows_do_not_force_an_unnecessary_crop_correction(self):
        reference = np.full((640, 480), 160, np.uint8)
        candidate = reference.copy()
        cv.ellipse(candidate, (475, 300), (90, 190), 0, 0, 360, 0, -1)
        pixels = module.compare_pixels(reference, candidate)
        self.assertGreater(pixels['addedEdgeGapFraction'], 0.05)
        checked = module.corroborate_gap(pixels, {'uncoveredFraction': 0})
        self.assertEqual(checked['addedEdgeGapFraction'], 0)
        self.assertGreater(checked['darkEdgeDifferenceFraction'], 0.05)
        empty = module.compare_pixels(reference, np.zeros_like(reference))
        self.assertEqual(module.corroborate_gap(empty, {'uncoveredFraction': 0})['addedEdgeGapFraction'], 1)


if __name__ == '__main__':
    unittest.main()
