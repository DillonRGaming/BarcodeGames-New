"""
Exports what the browser needs to put live 3D objects on top of the pre-rendered village:
  - models/easel.glb   a wooden easel holding a blank canvas (the canvas face is its own mesh: 'canvas_face')
  - models/scene.json  the village camera, sun and sky settings for the chosen look, so the live objects match the render

    blender -b village.blend -P easel.py -- [look name]      (default '5c late afternoon')
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'textures')
OUT = os.path.join(HERE, '..', 'models')
os.makedirs(OUT, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
LOOK = argv[0] if argv else '5c late afternoon'

# the look's settings live in looks.py: read them from there so the two never disagree
src = open(os.path.join(HERE, 'looks.py')).read()
presets_src = src[src.index('PRESETS = {'):src.index('}\n', src.index('PRESETS = {')) + 2]
ns = {}
exec(presets_src, ns)
look = ns['PRESETS'][LOOK]

scene = bpy.context.scene
cam = scene.camera
world_nodes = scene.world.node_tree.nodes
mapping = next(n for n in world_nodes if n.type == 'MAPPING')

# ---------- the sun for this look (same maths as looks.py) ----------
az, el, energy, colour = look['sun']
a, e = math.radians(az), math.radians(el)
to_sun = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))

# ---------- camera ----------
cd = cam.data
mw = cam.matrix_world
info = {
    'look': LOOK,
    'background': f'renders/full/{LOOK}.png',
    'render': [scene.render.resolution_x, scene.render.resolution_y],
    'camera': {
        'position': list(mw.translation),
        'forward': list(mw.to_3x3() @ Vector((0, 0, -1))),
        'up': list(mw.to_3x3() @ Vector((0, 1, 0))),
        'lens_mm': cd.lens, 'sensor_width_mm': cd.sensor_width, 'sensor_fit': cd.sensor_fit,
    },
    'sun': {'to_sun': list(to_sun), 'energy': energy, 'colour': list(colour), 'angle_deg': look.get('sun_angle', 1.0)},
    'sky': {
        'hdri': {'day': 'kloofendal_48d_partly_cloudy_puresky_2k.hdr', 'sunset': 'belfast_sunset_puresky_2k.hdr'}[look['sky']],
        'fill': look['fill'], 'rotation_z': mapping.inputs['Rotation'].default_value[2],
    },
    'exposure': look['exp'],
    'note': 'Blender coordinates: Z up. three.js: (x, y, z) -> (x, z, -y).',
}
json.dump(info, open(os.path.join(OUT, 'scene.json'), 'w'), indent=2)

# ---------- the easel: a fresh scene with only the model in it ----------
bpy.ops.wm.read_factory_settings(use_empty=True)


def image_material(name, tex, tint=None, rough=None):
    """UV-mapped image textures only, so the glTF exporter carries them over."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    diff = nt.nodes.new('ShaderNodeTexImage'); diff.image = bpy.data.images.load(os.path.join(TEX, f'{tex}_diff.jpg'))
    col = diff.outputs['Color']
    if tint:
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
        mix.inputs['B'].default_value = (*tint, 1); nt.links.new(col, mix.inputs['A']); col = mix.outputs['Result']
    nt.links.new(col, bsdf.inputs['Base Color'])
    r = nt.nodes.new('ShaderNodeTexImage'); r.image = bpy.data.images.load(os.path.join(TEX, f'{tex}_rough.jpg')); r.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(os.path.join(TEX, f'{tex}_nor.jpg')); n.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


WOOD = image_material('easel wood', 'weathered_planks', tint=(1.0, 0.85, 0.65))
LINEN = bpy.data.materials.new('canvas linen'); LINEN.use_nodes = True
LINEN.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.92, 0.9, 0.85, 1)
LINEN.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
FACE = bpy.data.materials.new('canvas face'); FACE.use_nodes = True
FACE.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.97, 0.96, 0.93, 1)
FACE.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.85
parts = []


def part(name, size, loc, mat, rot=(0, 0, 0), uv_scale=1.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # scale UVs to the piece's length so the wood grain isn't stretched
    for loop in ob.data.uv_layers.active.data:
        loop.uv = loop.uv * uv_scale * max(size)
    bev = ob.modifiers.new('bevel', 'BEVEL'); bev.width = min(size) * 0.25; bev.segments = 2
    ob.data.materials.append(mat)
    parts.append(ob)
    return ob


# three legs: two in front leaning back, one behind (metres; the easel stands at the origin, facing -Y)
lean = math.radians(8)
for side in (-1, 1):
    part('front leg', (0.045, 0.03, 1.75), (side * 0.28, 0.06, 0.86), WOOD, rot=(lean, side * math.radians(-6), 0), uv_scale=0.6)
part('back leg', (0.04, 0.03, 1.7), (0, 0.42, 0.8), WOOD, rot=(math.radians(-22), 0, 0), uv_scale=0.6)
part('mast', (0.05, 0.035, 1.9), (0, 0.04, 0.98), WOOD, rot=(lean, 0, 0), uv_scale=0.6)
part('ledge', (0.78, 0.1, 0.035), (0, -0.01, 0.62), WOOD, uv_scale=0.6)
part('ledge lip', (0.78, 0.015, 0.05), (0, -0.06, 0.65), WOOD, uv_scale=0.6)
part('cross bar', (0.62, 0.03, 0.04), (0, 0.13, 0.35), WOOD, uv_scale=0.6)

# the canvas: a stretched linen panel on the ledge, leaning with the mast, and a clamp on top
cw, ch, cdep = 0.6, 0.78, 0.03
tilt = Matrix.Rotation(lean, 4, 'X')
centre = Vector((0, -0.045, 0.64 + ch / 2 + 0.01))
canvas = part('canvas', (cw, cdep, ch), centre, LINEN, rot=(lean, 0, 0))
# the front face as its own mesh, so the browser can draw on it
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
face = bpy.context.active_object; face.name = 'canvas_face'
face.scale = (cw * 0.98, ch * 0.98, 1)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
face.rotation_euler = (math.pi / 2 + lean, 0, 0)
face.location = centre + (tilt @ Vector((0, -cdep / 2 - 0.002, 0, 1))).to_3d()
face.data.materials.append(FACE)
parts.append(face)
part('clamp', (0.12, 0.06, 0.05), (0, -0.03 + math.sin(lean) * (ch + 0.05), 0.64 + ch + 0.06), WOOD, rot=(lean, 0, 0))

for ob in parts:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'easel.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True, export_image_format='JPEG')
print('EXPORTED', os.path.join(OUT, 'easel.glb'))
