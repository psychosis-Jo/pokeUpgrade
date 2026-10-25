from pathlib import Path
from PIL import Image, ImageOps, ImageFilter, ImageEnhance

root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'game-cover-party.png').convert('RGB')
size = (1600, 1200)
background = ImageOps.fit(source, size, centering=(0.5, 0.48)).filter(ImageFilter.GaussianBlur(42))
background = ImageEnhance.Color(background).enhance(0.75)
background = Image.blend(background, Image.new('RGB', size, '#f5dfc5'), 0.2)
art = ImageOps.contain(source, (1440, 1080), Image.Resampling.LANCZOS)
x, y = (size[0] - art.width) // 2, (size[1] - art.height) // 2
# Soft edges integrate the portrait illustration into a wider cover without cropping it.
mask = Image.new('L', art.size, 255)
from PIL import ImageDraw
draw = ImageDraw.Draw(mask)
draw.rectangle((0, 0, art.width - 1, art.height - 1), outline=0, width=4)
mask = mask.filter(ImageFilter.GaussianBlur(9))
background.paste(art, (x, y), mask)
out = root / 'output' / 'covers'
out.mkdir(parents=True, exist_ok=True)
target = out / '熟人局升级-封面-1600x1200.jpg'
background.save(target, quality=95, optimize=True, subsampling=0)
print(f'{target}\n{background.size}, {target.stat().st_size:,} bytes')
