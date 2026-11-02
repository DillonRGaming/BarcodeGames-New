#!/usr/bin/env python3
"""
Fetch Baggage Claim item art from Pixabay's official API (transparent-background images only).

Note: the 30 images in the game were hand-picked from candidates (sources in credits.json there).
This script auto-picks, so check what it saves; use it as a starting point for new items.

Needs a free Pixabay API key: sign in at pixabay.com, then copy the key shown on
https://pixabay.com/api/docs/ into ~/.config/pixabay/key (or set PIXABAY_KEY).

Usage:
  python3 tools/pixabay/fetch.py            # fetch items that don't have art yet
  python3 tools/pixabay/fetch.py --force    # fetch them all again
  python3 tools/pixabay/fetch.py walkman    # just these ids

Saves app/core/games/dying-to-know/assets/images/killing/baggage-claim/<id>.png (max 600 px)
and credits.json beside them (Pixabay's licence is free to use; credit is appreciated).
"""
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'app/core/games/dying-to-know/assets/images/killing/baggage-claim')

HEADERS = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'}

# id -> (search words, a word that must appear in the image's tags)
ITEMS = {
    'fedora': ('fedora hat', 'hat'), 'desk-lamp': ('vintage desk lamp', 'lamp'), 'old-key': ('antique key', 'key'),
    'revolver': ('revolver', 'revolver'), 'sneaker': ('sneaker shoe', 'shoe'), 'cassette': ('cassette tape', 'cassette'),
    'walkman': ('walkman', 'walkman'), 'rotary-phone': ('rotary phone', 'phone'), 'typewriter': ('typewriter', 'typewriter'),
    'polaroid': ('polaroid camera', 'camera'), 'boombox': ('boombox', 'boombox'), 'vhs-tape': ('vhs tape', 'vhs'),
    'rubiks-cube': ('rubik cube', 'cube'), 'roller-skate': ('roller skate', 'skate'), 'joystick': ('joystick', 'joystick'),
    'calculator-watch': ('digital wristwatch', 'watch'), 'alarm-clock': ('alarm clock', 'alarm'), 'transistor-radio': ('old radio', 'radio'),
    'vinyl-record': ('vinyl record', 'vinyl'), 'headphones': ('headphones', 'headphones'), 'lava-lamp': ('lava lamp', 'lamp'),
    'umbrella': ('umbrella', 'umbrella'), 'briefcase': ('leather briefcase', 'briefcase'), 'pocket-watch': ('pocket watch', 'watch'),
    'hair-dryer': ('hair dryer', 'dryer'), 'toaster': ('toaster', 'toaster'), 'trophy': ('trophy', 'trophy'),
    'binoculars': ('binoculars', 'binoculars'), 'teddy-bear': ('teddy bear', 'teddy'), 'sunglasses': ('sunglasses', 'sunglasses'),
}


def api_key():
    key = os.environ.get('PIXABAY_KEY')
    if not key:
        path = os.path.expanduser('~/.config/pixabay/key')
        if os.path.exists(path):
            key = open(path).read().strip()
    if not key:
        sys.exit('No Pixabay API key. Put it in ~/.config/pixabay/key (see the top of this file).')
    return key


def search(key, words, image_type):
    q = urllib.parse.urlencode({
        'key': key, 'q': words, 'colors': 'transparent', 'safesearch': 'true',
        'order': 'popular', 'per_page': 30, 'image_type': image_type,
    })
    req = urllib.request.Request(f'https://pixabay.com/api/?{q}', headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get('hits', [])


def fetch_bytes(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
        return r.read()


def usable(png_path):
    """Really a cut-out: a decent share of transparent pixels, and the object isn't mostly flat black"""
    from PIL import Image
    im = Image.open(png_path).convert('RGBA')
    im.thumbnail((128, 128))
    px = list(im.getdata())
    clear = sum(1 for p in px if p[3] < 20) / len(px)
    solid = [p for p in px if p[3] >= 20]
    dark = sum(1 for p in solid if p[0] + p[1] + p[2] < 40) / max(1, len(solid))
    return 0.12 < clear < 0.92 and dark < 0.85


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    key = api_key()
    os.makedirs(OUT, exist_ok=True)
    credits_path = os.path.join(OUT, 'credits.json')
    credits = json.load(open(credits_path)) if os.path.exists(credits_path) else {}

    for item_id in ITEMS:
        if args and item_id not in args:
            continue
        dest = os.path.join(OUT, f'{item_id}.png')
        if os.path.exists(dest) and not force:
            print(f'skip   {item_id}')
            continue
        if os.path.exists(dest):
            os.remove(dest)
        words, must = ITEMS[item_id]
        saved = False
        # real photos first for a consistent look, illustrations only if no photo fits
        for image_type in ('photo', 'illustration'):
            for hit in search(key, words, image_type):
                if must not in hit.get('tags', '').lower() or not hit.get('largeImageURL', '').lower().endswith('.png'):
                    continue
                tmp = dest + '.download'
                open(tmp, 'wb').write(fetch_bytes(hit['largeImageURL']))
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-vf',
                                "scale='if(gt(iw,ih),min(600,iw),-2)':'if(gt(iw,ih),-2,min(600,ih))'", dest], check=True)
                os.remove(tmp)
                if not usable(dest):
                    os.remove(dest)
                    continue
                credits[item_id] = {'page': hit.get('pageURL'), 'user': hit.get('user'), 'tags': hit.get('tags'), 'type': image_type}
                print(f'saved  {item_id:<17} {image_type:<12} <- {hit.get("pageURL")}')
                saved = True
                break
            if saved:
                break
        if not saved:
            print(f'none   {item_id} ({words})')

    json.dump(credits, open(credits_path, 'w'), indent=2)


if __name__ == '__main__':
    main()
