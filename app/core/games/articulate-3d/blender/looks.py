"""
Render the village under several lighting / art-style presets, to pick a look.

    blender -b village.blend -P looks.py -- outdir [samples] [width] [height]
"""
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = os.path.abspath(argv[0])
SAMPLES = int(argv[1]) if len(argv) > 1 else 16
W, H = (int(argv[2]), int(argv[3])) if len(argv) > 3 else (480, 270)
ONLY = argv[4] if len(argv) > 4 else None  # render just the presets whose name starts with this
TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'textures')
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
wn = scene.world.node_tree.nodes
env = next(n for n in wn if n.type == 'TEX_ENVIRONMENT')
fill = wn['Background']          # how much the sky lights the scene
seen = wn['Background.001']      # how bright the sky looks to the camera
sun = bpy.data.objects['sun']
lit = bpy.data.materials['lit window'].node_tree.nodes['Principled BSDF']
lantern = bpy.data.materials['lantern glass'].node_tree.nodes['Principled BSDF']
lamp = bpy.data.lights['lamp light']
cam = scene.camera.data

def add_ao(distance=0.6):
    """Extra ambient occlusion baked into every material: the colour darkens in creases and corners.
    Returns the mix nodes, whose Factor sets the strength (0 = off)."""
    mixes = []
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = distance; ao.samples = 8
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs['Factor'].default_value = 0
        src = bsdf.inputs['Base Color']
        if src.is_linked:
            link = src.links[0]; nt.links.new(link.from_socket, ao.inputs['Color']); nt.links.new(link.from_socket, mix.inputs['A'])
        else:
            ao.inputs['Color'].default_value = src.default_value; mix.inputs['A'].default_value = src.default_value
        nt.links.new(ao.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], src)
        mixes.append(mix)
    return mixes


AO = add_ao()

HDRI = {
    'day': 'kloofendal_48d_partly_cloudy_puresky_2k.hdr',
    'sunset': 'belfast_sunset_puresky_2k.hdr',
}


def aim_sun(azimuth_deg, elevation_deg):
    """azimuth: 0 = from the camera side, negative = from the left; elevation above the horizon"""
    a, e = math.radians(azimuth_deg), math.radians(elevation_deg)
    to_sun = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    sun.rotation_euler = to_sun.to_track_quat('Z', 'Y').to_euler()


PRESETS = {
    # name: sky, sky fill, sky seen, sun (azimuth, elevation, energy, colour), exposure, look, ao (0..1), windows, f-stop
    '1a midday':                 dict(sky='day', fill=0.45, seen=1.0, sun=(-38, 45, 7.5, (1, 0.93, 0.82)), exp=0.35, look='AgX - Punchy', ao=0.0),
    '1b midday + AO':            dict(sky='day', fill=0.45, seen=1.0, sun=(-38, 45, 7.5, (1, 0.93, 0.82)), exp=0.45, look='AgX - Punchy', ao=0.6),
    '1c midday + strong AO':     dict(sky='day', fill=0.55, seen=1.0, sun=(-38, 45, 7.5, (1, 0.93, 0.82)), exp=0.55, look='AgX - Punchy', ao=1.0),
    '1d late morning, soft sun': dict(sky='day', fill=0.6, seen=1.0, sun=(-25, 35, 6, (1, 0.9, 0.78)), exp=0.5, look='AgX - Punchy', ao=0.7, sun_angle=6),
    '3a cloudy + AO':            dict(sky='day', fill=1.3, seen=1.0, sun=(-30, 50, 1.2, (1, 0.97, 0.92)), exp=0.7, look='AgX - Base Contrast', ao=0.7),
    '3b bright overcast':        dict(sky='day', fill=1.7, seen=1.1, sun=(-30, 50, 0.6, (1, 0.97, 0.92)), exp=0.6, look='AgX - Punchy', ao=1.0),
    '3c hazy warm day':          dict(sky='day', fill=1.1, seen=1.0, sun=(-45, 40, 2.5, (1, 0.85, 0.65)), exp=0.6, look='AgX - Punchy', ao=0.8, sun_angle=8),
    '5a golden + AO':            dict(sky='sunset', fill=0.5, seen=1.0, sun=(-62, 14, 7, (1, 0.62, 0.34)), exp=0.55, look='AgX - Punchy', ao=0.7),
    '5b golden, higher sun':     dict(sky='sunset', fill=0.55, seen=1.0, sun=(-55, 24, 7.5, (1, 0.7, 0.42)), exp=0.5, look='AgX - Punchy', ao=0.7),
    '5c late afternoon':         dict(sky='day', fill=0.5, seen=1.0, sun=(-55, 25, 7.5, (1, 0.78, 0.55)), exp=0.45, look='AgX - Punchy', ao=0.7),
    '5d golden, soft':           dict(sky='sunset', fill=0.8, seen=1.0, sun=(-62, 14, 4.5, (1, 0.66, 0.4)), exp=0.6, look='AgX - Base Contrast', ao=0.8, sun_angle=6),
    '5e golden from the right':  dict(sky='sunset', fill=0.5, seen=1.0, sun=(62, 14, 7, (1, 0.62, 0.34)), exp=0.55, look='AgX - Punchy', ao=0.7),
}

scene.cycles.samples = SAMPLES
scene.render.resolution_x, scene.render.resolution_y = W, H
for name, p in PRESETS.items():
    if ONLY and not name.startswith(ONLY):
        continue
    env.image = bpy.data.images.load(os.path.join(TEX, HDRI[p['sky']]), check_existing=True)
    fill.inputs['Strength'].default_value = p['fill']
    seen.inputs['Strength'].default_value = p['seen']
    az, el, energy, colour = p['sun']
    aim_sun(az, el)
    sun.data.energy = energy
    sun.data.color = colour
    scene.view_settings.exposure = p['exp']
    scene.view_settings.look = p['look']
    w = p.get('windows', 0)
    lit.inputs['Emission Strength'].default_value = w
    lantern.inputs['Emission Strength'].default_value = w * 2
    lamp.energy = w * 15
    cam.dof.aperture_fstop = p.get('fstop', 5.6)
    sun.data.angle = math.radians(p.get('sun_angle', 1.0))  # bigger = softer shadow edges
    for mix in AO:
        mix.inputs['Factor'].default_value = p.get('ao', 0)
    scene.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('LOOK', name)
