import sys
from PIL import Image

if len(sys.argv) != 6:
    print("Usage: stitch_tiles.py tl.png tr.png bl.png br.png output.png", file=sys.stderr)
    sys.exit(1)

tl, tr, bl, br, output = sys.argv[1:6]

tl_img = Image.open(tl)
tw, th = tl_img.size

result = Image.new("RGBA", (tw * 2, th * 2))
for path, x, y in [(tl, 0, 0), (tr, tw, 0), (bl, 0, th), (br, tw, th)]:
    img = Image.open(path)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    result.paste(img, (x, y), img if img.mode == "RGBA" else None)

result.save(output, "PNG")
print(f"Stitched {tw}x{th} tiles -> {output} ({tw*2}x{th*2})")
