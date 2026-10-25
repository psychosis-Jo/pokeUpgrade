"""Local image processing only; no API calls or credentials."""
from pathlib import Path
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).parent
HELPER = '/Users/Adun/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py'
NAMES = ['table', 'teammate', 'left', 'right', 'self', 'whiskers']
for name in NAMES:
    dest = ROOT / f'{name}.png'
    if not dest.exists():
        subprocess.run([sys.executable, HELPER, '--input', str(ROOT / f'{name}-source.png'),
                        '--out', str(dest), '--auto-key', 'border', '--soft-matte',
                        '--transparent-threshold', '12', '--opaque-threshold', '220', '--despill'], check=True)
    im = Image.open(dest).convert('RGBA')
    alpha = im.getchannel('A')
    assert all(alpha.getpixel(p) == 0 for p in [(0, 0), (im.width-1, 0), (0, im.height-1), (im.width-1, im.height-1)])
    print(name, 'alpha range', alpha.getextrema(), 'visible bounds', alpha.getbbox())

def cutout(name):
    im = Image.open(ROOT / f'{name}.png').convert('RGBA')
    return im.crop(im.getchannel('A').getbbox())

for name in ['teammate', 'left', 'right', 'self']:
    im = cutout(name)
    side = min(im.width, int(im.height * .61))
    x = (im.width-side)//2
    avatar = im.crop((x, 0, x+side, side)).resize((512, 512), Image.Resampling.LANCZOS)
    avatar.save(ROOT / f'{name}-avatar.png')

font_path = '/System/Library/Fonts/STHeiti Medium.ttc'
def font(size):
    return ImageFont.truetype(font_path, size)

sheet = Image.new('RGB', (1200, 900), '#e9e2d5')
sd = ImageDraw.Draw(sheet)
for i, name in enumerate(NAMES):
    im = cutout(name)
    im.thumbnail((360, 365), Image.Resampling.LANCZOS)
    x, y = (i%3)*400, (i//3)*450
    sheet.paste(im, (x+(400-im.width)//2, y+25), im)
    sd.text((x+20, y+410), name, fill='#283238', font=font(24))
sheet.save(ROOT / 'asset-sheet.jpg', quality=92)

preview = Image.open(ROOT / 'background.png').convert('RGBA')
def paste(name, center, size):
    im = cutout(name)
    im.thumbnail(size, Image.Resampling.LANCZOS)
    preview.alpha_composite(im, (int(center[0]-im.width/2), int(center[1]-im.height/2)))

paste('teammate', (512, 310), (300, 320))
paste('table', (512, 740), (760, 850))
paste('left', (140, 650), (310, 360))
paste('right', (884, 650), (310, 360))
d = ImageDraw.Draw(preview)
def panel(rect, fill='#fff3df', radius=24):
    d.rounded_rectangle(rect, radius=radius, fill=fill)
def label(text, xy, size=26, color='#503a28', anchor='mm'):
    d.text(xy, text, font=font(size), fill=color, anchor=anchor)
panel((275, 25, 749, 100), '#99683e')
label('熟人局升级', (512, 63), 44, '#fff3df')
panel((130, 112, 894, 173))
label('打 2 · 红桃主     闲家得分 35 / 80', (512, 142), 29)
for name, xy in [('队友 · 陈皮', (512, 465)), ('小米 · 对手', (145, 850)), ('阿杰 · 对手', (879, 850))]:
    panel((xy[0]-130, xy[1]-25, xy[0]+130, xy[1]+25), '#fff3df')
    label(name, xy, 23)

def card(x, y, rank, suit, w=92, h=128, selected=False):
    panel((x, y, x+w, y+h), '#367e95' if selected else '#d3b998', 10)
    d.rounded_rectangle((x+3, y+3, x+w-3, y+h-3), radius=8, fill='#fffaf0')
    color = '#b83249' if suit in ['♥', '♦'] else '#283238'
    label(rank, (x+w*.3, y+24), 25, color)
    label(suit, (x+w/2, y+h*.65), 37, color)

for x, y, rank in [(466, 490, 'A'), (265, 665, 'K'), (667, 665, '10'), (466, 870, '5')]:
    card(x, y, rank, '♥', selected=rank=='A')
panel((295, 802, 729, 854))
label('队友赢墩 · 本墩 15 分', (512, 828), 26)
panel((0, 1060, 1024, 1536), '#f4e7cc', 32)
label('你 · 庄家     手牌 25 张', (45, 1094), 25, anchor='lm')
ranks = ['2', '2', '3', '3', '4', '4', '5', '5', '6', '6', '7', '7', '8', '8', '9', '9', '10', '10', 'J', 'J', 'Q', 'Q', 'K', 'K', 'A']
for i, rank in enumerate(ranks):
    card(30+(i%13)*74, 1125+(i//13)*133, rank, ['♥', '♦', '♠', '♣'][i%4], w=70, h=126, selected=i==22)
for rect, title, color in [((40, 1420, 310, 1500), '清空', '#e5d4b4'), ((345, 1420, 635, 1500), '推荐', '#367e95'), ((670, 1420, 984, 1500), '出牌', '#ef9b40')]:
    panel(rect, color)
    label(title, ((rect[0]+rect[2])/2, 1460), 34, '#503a28' if title=='清空' else '#ffffff')
preview.convert('RGB').save(ROOT / 'composite-preview.jpg', quality=94)
print('Saved asset sheet, avatars, and composite preview. Preview cards are illustrative, not a legal game snapshot.')
