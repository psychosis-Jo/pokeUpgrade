"""Export existing art at runtime sizes, without changing source artwork."""
from pathlib import Path
from PIL import Image

source = Path(__file__).parent
target = source.parents[2] / 'minigame' / 'assets' / 'living-room'
target.mkdir(parents=True, exist_ok=True)
Image.open(source / 'background.png').convert('RGB').resize((600, 900), Image.Resampling.LANCZOS).save(target / 'background.jpg', quality=80, optimize=True)
for name in ['table', 'teammate', 'left', 'right', 'self-avatar', 'whiskers']:
    im = Image.open(source / f'{name}.png').convert('RGBA')
    im = im.crop(im.getchannel('A').getbbox())
    # Level the tabletop's long axis before fitting it into the game viewport.
    if name == 'table':
        im = im.rotate(17, resample=Image.Resampling.BICUBIC, expand=True)
        im = im.crop(im.getchannel('A').getbbox())
    im.thumbnail((420, 460) if name != 'whiskers' else (240, 100), Image.Resampling.LANCZOS)
    im.quantize(colors=192).save(target / f'{name}.png', optimize=True)
print(target)
