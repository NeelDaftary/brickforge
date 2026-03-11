import pathlib
import sys
import unittest


THIS_DIR = pathlib.Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from color_quantization import (  # noqa: E402
    LEGO_COLORS,
    linear_rgb_to_nearest_lego_hex,
    srgb_to_linear,
    srgb_tuple_to_nearest_lego_hex,
)


def hex_to_srgb01(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return (
        int(h[0:2], 16) / 255.0,
        int(h[2:4], 16) / 255.0,
        int(h[4:6], 16) / 255.0,
    )


class ColorQuantizationTests(unittest.TestCase):
    def test_exact_palette_srgb_colors_map_to_themselves(self) -> None:
        for hex_color in LEGO_COLORS:
            with self.subTest(hex_color=hex_color):
                self.assertEqual(
                    srgb_tuple_to_nearest_lego_hex(hex_to_srgb01(hex_color)),
                    hex_color,
                )

    def test_exact_palette_linear_colors_map_to_themselves(self) -> None:
        for hex_color in LEGO_COLORS:
            with self.subTest(hex_color=hex_color):
                r, g, b = hex_to_srgb01(hex_color)
                self.assertEqual(
                    linear_rgb_to_nearest_lego_hex(
                        (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))
                    ),
                    hex_color,
                )

    def test_linear_and_srgb_entrypoints_agree_for_same_color(self) -> None:
        samples = [
            "#FF0000",
            "#00FF00",
            "#0000FF",
            "#808080",
            "#FFD500",
            "#5A5A5A",
        ]
        for hex_color in samples:
            with self.subTest(hex_color=hex_color):
                r, g, b = hex_to_srgb01(hex_color)
                linear_result = linear_rgb_to_nearest_lego_hex(
                    (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))
                )
                srgb_result = srgb_tuple_to_nearest_lego_hex((r, g, b))
                self.assertEqual(linear_result, srgb_result)

    def test_primary_colors_still_land_on_expected_palette_entries(self) -> None:
        self.assertEqual(srgb_tuple_to_nearest_lego_hex((1.0, 0.0, 0.0)), "#DB0000")
        self.assertEqual(srgb_tuple_to_nearest_lego_hex((1.0, 1.0, 1.0)), "#FFFFFF")
        self.assertEqual(srgb_tuple_to_nearest_lego_hex((0.0, 0.0, 0.0)), "#101010")


if __name__ == "__main__":
    unittest.main()
