"""Original, redistributable diagnostic image/font. No publisher assets."""
from pathlib import Path
from PIL import Image, ImageDraw
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

out = Path(__file__).parent / 'assets'
out.mkdir(exist_ok=True)
image = Image.new('RGB', (960, 360), '#f1eee6')
d = ImageDraw.Draw(image)
d.polygon([(0, 250), (160, 100), (320, 220), (510, 70), (720, 225), (960, 130), (960, 360), (0, 360)], fill='#bdc6b3')
d.polygon([(0, 290), (260, 215), (400, 285), (680, 160), (960, 275), (960, 360), (0, 360)], fill='#819782')
d.polygon([(430, 360), (535, 285), (625, 260), (560, 220), (650, 240), (690, 270), (560, 320), (535, 360)], fill='#e6e7d7')
d.ellipse((95, 50, 145, 100), fill='#d2b993')
image.save(out / 'river.png')

# Deliberately distinctive A advances 1200 units: load can be measured, not guessed.
builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder(['.notdef', 'space', 'A'])
glyphs = {}
for name in ['.notdef', 'space', 'A']:
    pen = TTGlyphPen(None)
    if name == 'A':
        pen.moveTo((80, 0)); pen.lineTo((600, 800)); pen.lineTo((1120, 0)); pen.closePath()
        pen.moveTo((450, 220)); pen.lineTo((750, 220)); pen.lineTo((600, 470)); pen.closePath()
    glyphs[name] = pen.glyph()
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({'.notdef': (1000, 0), 'space': (300, 0), 'A': (1200, 80)})
builder.setupHorizontalHeader(ascent=850, descent=-150)
builder.setupCharacterMap({32: 'space', 65: 'A'})
builder.setupNameTable({'familyName': 'Reader Probe', 'styleName': 'Regular', 'uniqueFontIdentifier': 'ReaderProbe-1', 'fullName': 'Reader Probe Regular', 'psName': 'ReaderProbe-Regular', 'version': 'Version 1.0'})
builder.setupOS2(sTypoAscender=850, sTypoDescender=-150, usWinAscent=850, usWinDescent=150)
builder.setupPost()
builder.setupMaxp()
builder.save(out / 'reader-probe.ttf')
