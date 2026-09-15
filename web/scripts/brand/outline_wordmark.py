# SPDX-License-Identifier: Apache-2.0
# Outlines the wordmark ("One" upright, "Pledge" italic) from Fraunces so logo files need no font.
# Writes scripts/brand/wordmark-glyphs.json: one SVG path in font units with the total advance width.
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

here = os.path.dirname(os.path.abspath(__file__))
files = os.path.join(here, '..', '..', '..', 'node_modules', '@fontsource-variable', 'fraunces', 'files')

def instance(name, axes):
    font = TTFont(os.path.join(files, name))
    return instantiateVariableFont(font, axes)

def run(font, text, x0, parts):
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    hmtx = font['hmtx']
    x = x0
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs)
        # flip y: font units are y-up, SVG is y-down
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        d = pen.getCommands()
        if d:
            parts.append(d)
        x += hmtx[name][0]
    return x

upright = instance('fraunces-latin-opsz-normal.woff2', {'wght': 600, 'opsz': 72})
italic = instance('fraunces-latin-opsz-italic.woff2', {'wght': 500, 'opsz': 72})
parts = []
x = run(upright, 'One', 0, parts)
x = run(italic, 'Pledge', x + 10, parts)
head = upright['hhea']
out = {'d': ' '.join(parts), 'width': x, 'ascent': head.ascent, 'descent': head.descent, 'unitsPerEm': upright['head'].unitsPerEm}
json.dump(out, open(os.path.join(here, 'wordmark-glyphs.json'), 'w'))
print('wordmark width', x, 'upm', out['unitsPerEm'], 'ascent', head.ascent, 'descent', head.descent)
