"""
A little French village street at sunset, built and rendered in Blender (Cycles).

Everything is real geometry: wall stones and roof tiles are separate bevelled blocks with their own tint,
the cobbles are individual stones, the tree's crown is thousands of leaf cards. Light comes from a physical
sunset sky plus a low sun, with bounced light, soft shadows and a little depth of field.

    blender -b -P village.py -- out.png [samples] [width] [height]
Also saves village.blend next to this script so the scene can be opened and tweaked.
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Matrix, Vector, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(__file__), 'render.png')
SAMPLES = int(argv[1]) if len(argv) > 1 else 64
RES = (int(argv[2]), int(argv[3])) if len(argv) > 3 else (960, 540)

random.seed(7)
rnd = random.random

# ---------- clean slate ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection


def link(obj):
    col.objects.link(obj)
    return obj


# ---------- materials ----------

def node_mat(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    build(nt, bsdf)
    return m


def ramp_by_rand(nt, bsdf, colours, attr='rand', rough=0.8, bump=0.0, noise_scale=6.0):
    """Base colour picked per piece from a colour ramp by its random attribute, plus a soft noise wash."""
    a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = attr; a.attribute_type = 'GEOMETRY'
    r = nt.nodes.new('ShaderNodeValToRGB')
    els = r.color_ramp.elements
    els[0].position = 0; els[0].color = (*colours[0], 1)
    els[1].position = 1; els[1].color = (*colours[-1], 1)
    for i, c in enumerate(colours[1:-1], 1):
        e = els.new(i / (len(colours) - 1)); e.color = (*c, 1)
    nt.links.new(a.outputs['Fac'], r.inputs['Fac'])
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = noise_scale; n.inputs['Detail'].default_value = 4
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 0.25
    nt.links.new(r.outputs['Color'], mix.inputs['A'])
    nt.links.new(n.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    if bump:
        b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = bump
        nt.links.new(n.outputs['Fac'], b.inputs['Height'])
        nt.links.new(b.outputs['Normal'], bsdf.inputs['Normal'])


def flat(name, rgb, rough=0.7, metal=0.0, emit=None, emit_strength=0):
    def b(nt, bsdf):
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emit:
            bsdf.inputs['Emission Color'].default_value = (*emit, 1)
            bsdf.inputs['Emission Strength'].default_value = emit_strength
    return node_mat(name, b)


def srgb(h):
    """'#rrggbb' → linear RGB"""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'textures')


def pbr(name, tex, scale=1.0, tint=None, bump=0.25, rough_mul=1.0, paint=None):
    """A photo-scanned Poly Haven material: colour, normal, roughness and height maps, box-projected in world space.
    tint multiplies the colour (for painted plaster and shutters)."""
    def b(nt, bsdf):
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])

        def img(kind, colour):
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = bpy.data.images.load(os.path.join(TEX, f'{tex}_{kind}.jpg'), check_existing=True)
            n.image.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
            n.projection = 'BOX'; n.projection_blend = 0.25
            nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
            return n
        diff = img('diff', True)
        colour = diff.outputs['Color']
        if tint:
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
            mix.inputs['B'].default_value = (*tint, 1)
            nt.links.new(colour, mix.inputs['A']); colour = mix.outputs['Result']
        if paint:  # painted wood: a flat paint colour, only lightly showing the grain underneath
            pm = nt.nodes.new('ShaderNodeMix'); pm.data_type = 'RGBA'; pm.blend_type = 'OVERLAY'; pm.inputs['Factor'].default_value = 0.35
            pm.inputs['A'].default_value = (*paint, 1)
            nt.links.new(diff.outputs['Color'], pm.inputs['B']); colour = pm.outputs['Result']
        nt.links.new(colour, bsdf.inputs['Base Color'])
        rough = img('rough', False)
        if rough_mul != 1.0:
            m = nt.nodes.new('ShaderNodeMath'); m.operation = 'MULTIPLY'; m.inputs[1].default_value = rough_mul
            nt.links.new(rough.outputs['Color'], m.inputs[0]); nt.links.new(m.outputs['Value'], bsdf.inputs['Roughness'])
        else:
            nt.links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
        nor = img('nor', False)
        nmap = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(nor.outputs['Color'], nmap.inputs['Color'])
        disp = img('disp', False)
        bmp = nt.nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = bump; bmp.inputs['Distance'].default_value = 0.05
        nt.links.new(disp.outputs['Color'], bmp.inputs['Height']); nt.links.new(nmap.outputs['Normal'], bmp.inputs['Normal'])
        nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
    return node_mat(name, b)


M_STONE_OLD = node_mat('wall stone', lambda nt, b: ramp_by_rand(nt, b, [srgb('#8f8270'), srgb('#b3a58c'), srgb('#9c8f7b'), srgb('#c2b296')], rough=0.9, bump=0.3, noise_scale=12))
M_COBBLE_OLD = node_mat('cobble', lambda nt, b: ramp_by_rand(nt, b, [srgb('#6f6a63'), srgb('#8d877e'), srgb('#a39b8f'), srgb('#7d6f66')], rough=0.85, bump=0.4, noise_scale=20))
M_TILE_OLD = node_mat('roof tile', lambda nt, b: ramp_by_rand(nt, b, [srgb('#b8562e'), srgb('#d0743c'), srgb('#c8663a'), srgb('#a5683e'), srgb('#9b8a4a')], rough=0.6, noise_scale=8))
M_STONE = pbr('stone wall', 'castle_wall_varriation', scale=0.45, bump=0.6)
M_COBBLE = pbr('cobbles', 'cobblestone_floor_04', scale=0.5, bump=0.9)
M_TILE = pbr('roof tiles', 'clay_roof_tiles_02', scale=0.55, bump=0.6)
M_WOOD = pbr('door wood', 'weathered_planks', scale=0.8, bump=0.4)
M_STEP = pbr('door step', 'concrete_floor_worn_001', scale=0.8, bump=0.3)
M_JOINT = flat('mortar', srgb('#4f463c'), 1.0)
M_DIRT = flat('dirt between cobbles', srgb('#3e372f'), 1.0)
M_WOOD_OLD = node_mat('wood', lambda nt, b: ramp_by_rand(nt, b, [srgb('#8a5a32'), srgb('#a36d3e')], rough=0.7, bump=0.2, noise_scale=30))
M_FRAME = pbr('window frame', 'distressed_painted_planks', scale=1.2, paint=srgb('#f1ebde'), bump=0.2)
M_GLASS_DARK = flat('glass', srgb('#1c232b'), 0.08, 0.2)
M_GLASS_LIT = flat('lit window', srgb('#3a2a1a'), 0.3, emit=srgb('#ffb15c'), emit_strength=0)  # daytime: no lights on
M_IRON = pbr('iron', 'metal_plate', scale=1.5, tint=(0.12, 0.12, 0.13), bump=0.15)
M_POT = pbr('terracotta pot', 'clay_plaster', scale=1.2, tint=srgb('#d27a4e'), bump=0.3)
M_LEAF = node_mat('leaves', lambda nt, b: ramp_by_rand(nt, b, [srgb('#4f7f2f'), srgb('#6c9a38'), srgb('#9ab04a'), srgb('#c69a3a')], attr='rand', rough=0.6, noise_scale=3))
M_BARK = pbr('bark', 'bark_brown_02', scale=1.5, bump=0.6)
SHUTTER_COLOURS = ['#3f7d8c', '#5f8f4e', '#3b5f9a', '#9a4a3a', '#6a8fb0', '#2f6b5e']
FACADES = ['#f2d6a2', '#f4c7b3', '#d9e4c8', '#f7e9c8', '#c9dceb', '#efd2d9']


def plaster(hexcol):
    return pbr('plaster ' + hexcol, 'painted_plaster_wall', scale=0.35, tint=srgb(hexcol), bump=0.35)


def plaster_old(hexcol):
    def b(nt, bsdf):
        n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 1.6; n.inputs['Detail'].default_value = 6
        r = nt.nodes.new('ShaderNodeValToRGB')
        base = srgb(hexcol)
        r.color_ramp.elements[0].color = (*[c * 0.82 for c in base], 1)
        r.color_ramp.elements[1].color = (*[min(1, c * 1.05) for c in base], 1)
        r.color_ramp.elements[0].position = 0.35; r.color_ramp.elements[1].position = 0.65
        nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
        nt.links.new(r.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.95
        g = nt.nodes.new('ShaderNodeTexNoise'); g.inputs['Scale'].default_value = 60
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.12
        nt.links.new(g.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return node_mat('plaster ' + hexcol, b)


def stripes(hexcol):
    def b(nt, bsdf):
        tc = nt.nodes.new('ShaderNodeTexCoord')
        w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'X'; w.inputs['Scale'].default_value = 1.6
        w.wave_profile = 'SAW'
        nt.links.new(tc.outputs['Object'], w.inputs['Vector'])
        r = nt.nodes.new('ShaderNodeValToRGB'); r.color_ramp.interpolation = 'CONSTANT'
        r.color_ramp.elements[0].color = (*srgb(hexcol), 1); r.color_ramp.elements[1].position = 0.5; r.color_ramp.elements[1].color = (*srgb('#f4efe4'), 1)
        nt.links.new(w.outputs['Fac'], r.inputs['Fac']); nt.links.new(r.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.85
    return node_mat('awning ' + hexcol, b)


# ---------- geometry helpers ----------

class Batch:
    """Many boxes in one mesh, each with its own random 'rand' value (for per-piece colour)."""

    def __init__(self, name, material, bevel=0.02, segments=2):
        self.bm = bmesh.new()
        self.rand = self.bm.faces.layers.float.new('rand')
        self.name, self.material, self.bevel, self.segments = name, material, bevel, segments

    def box(self, size, loc, rot=(0, 0, 0), value=None):
        m = Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1))
        res = bmesh.ops.create_cube(self.bm, size=1, matrix=m)
        v = rnd() if value is None else value
        faces = {f for vert in res['verts'] for f in vert.link_faces}
        for f in faces:
            f[self.rand] = v

    def done(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me); self.bm.free()
        me.materials.append(self.material)
        ob = link(bpy.data.objects.new(self.name, me))
        if self.bevel:
            bev = ob.modifiers.new('bevel', 'BEVEL'); bev.width = self.bevel; bev.segments = self.segments; bev.limit_method = 'ANGLE'
        for p in me.polygons:
            p.use_smooth = True
        return ob


def cube(name, size, loc, material, rot=(0, 0, 0), bevel=0.015):
    b = Batch(name, material, bevel)
    b.box(size, loc, rot, 0.5)
    return b.done()


# ---------- ground: real cobbles over dirt ----------

bpy.ops.mesh.primitive_plane_add(size=1, location=(6, -6, 0))
dirt = bpy.context.active_object; dirt.scale = (60, 26, 1); dirt.data.materials.append(M_DIRT)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)  # so the cobble texture is at real size, not stretched

dirt.data.materials.clear(); dirt.data.materials.append(M_COBBLE)  # the whole street is photo-scanned cobbles

# ---------- the terrace wall the houses stand on ----------

def stone_wall(name, x0, x1, z0, z1, yface, depth=0.5, **_):
    """A stone wall: one slab with the photo-scanned stone texture (stones and mortar are in the texture)."""
    return cube(name, (x1 - x0, depth, z1 - z0), ((x0 + x1) / 2, yface + depth / 2, (z0 + z1) / 2), M_STONE, bevel=0.03)


stone_wall('terrace wall', -14, 26, 0, 1.2, 1.5, depth=0.6, course=(0.3, 0.42))
terrace_top = cube('terrace top', (40, 4, 0.14), (6, 3.6, 1.27), pbr('terrace paving', 'concrete_floor_worn_001', scale=0.4, bump=0.4), bevel=0.03)

# ---------- houses ----------

HOUSE_Y = 4.2          # front face of the houses
FLOOR = 2.3


def window(x, z, shutter_mat, planter=False, balcony=False, lit=False):
    y = HOUSE_Y - 0.04
    # the frame is four bars around the glass (a solid block would hide it)
    for fx, fz, fw, fh in ((0, 0.69, 1.0, 0.08), (0, -0.69, 1.0, 0.08), (-0.46, 0, 0.08, 1.45), (0.46, 0, 0.08, 1.45)):
        cube('frame', (fw, 0.16, fh), (x + fx, y, z + fz), M_FRAME, bevel=0.01)
    cube('glass', (0.86, 0.03, 1.32), (x, y - 0.01, z), M_GLASS_LIT if lit else M_GLASS_DARK, bevel=0)
    cube('mullion', (0.05, 0.07, 1.32), (x, y - 0.05, z), M_FRAME, bevel=0.01)
    cube('transom', (0.86, 0.07, 0.05), (x, y - 0.05, z + 0.18), M_FRAME, bevel=0.01)
    cube('sill', (1.2, 0.26, 0.08), (x, y - 0.1, z - 0.76), M_FRAME)
    for side in (-1, 1):
        s = cube('shutter', (0.5, 0.06, 1.42), (x + side * 0.8, y - 0.14, z), shutter_mat, rot=(0, 0, side * 0.3), bevel=0.012)
        for i in range(6):
            cube('slat', (0.42, 0.04, 0.05), (x + side * 0.79, y - 0.19, z - 0.55 + i * 0.22), shutter_mat, rot=(0.5, 0, side * 0.3), bevel=0.005)
    if planter:
        cube('window box', (1.15, 0.3, 0.26), (x, y - 0.3, z - 0.92), M_POT)
        leaves_blob((x, y - 0.32, z - 0.72), (0.55, 0.16, 0.14), 220, flowers=True)
    if balcony:
        cube('balcony', (1.7, 0.6, 0.1), (x, y - 0.34, z - 0.8), M_FRAME)
        for i in range(9):
            cube('rail', (0.025, 0.025, 0.5), (x - 0.8 + i * 0.2, y - 0.62, z - 0.5), M_IRON, bevel=0)
        cube('rail top', (1.7, 0.04, 0.04), (x, y - 0.62, z - 0.24), M_IRON, bevel=0.005)


def roof(x, width, z_eave, depth):
    """A gable roof covered with individual overlapping tiles."""
    pitch = math.radians(38)
    half = width / 2 + 0.3
    run = half
    # the roof deck under the tiles, so no gaps show through
    deck = bmesh.new()
    ridge = z_eave + run * math.tan(pitch)
    vs = [deck.verts.new(v) for v in [(x - half, HOUSE_Y - 0.3, z_eave), (x, HOUSE_Y - 0.3, ridge), (x + half, HOUSE_Y - 0.3, z_eave),
                                         (x - half, HOUSE_Y + depth + 0.3, z_eave), (x, HOUSE_Y + depth + 0.3, ridge), (x + half, HOUSE_Y + depth + 0.3, z_eave)]]
    deck.faces.new([vs[0], vs[1], vs[4], vs[3]]); deck.faces.new([vs[1], vs[2], vs[5], vs[4]])
    deck.faces.new([vs[0], vs[1], vs[2]]); deck.faces.new([vs[3], vs[5], vs[4]])
    me = bpy.data.meshes.new('roof'); deck.to_mesh(me); me.materials.append(M_TILE)
    ob = link(bpy.data.objects.new('roof', me))
    sol = ob.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = 0.12; sol.offset = 1


def house(x, width, floors, sign=None, awning=None):
    base = 1.34
    depth = 5
    facade = plaster(random.choice(FACADES))
    shutter = pbr('shutter', 'wood_shutter', scale=1.4, paint=srgb(random.choice(SHUTTER_COLOURS)), bump=0.3)
    height = floors * FLOOR + 0.5
    # stone ground floor, plaster above
    cols = max(1, round(width / 2.2))
    holes = []
    for c in range(cols):
        wx = x - width / 2 + (c + 0.5) * (width / cols)
        holes.append((wx - 0.62, wx + 0.62, base, base + 2.2) if c == cols // 2 else (wx - 0.52, wx + 0.52, base + 0.6, base + 2.1))
    # stone facing on the ground floor, flush with the wall so windows and doors sit in front of it
    stone_wall('ground floor stone', x - width / 2, x + width / 2, base, base + 2.1, HOUSE_Y - 0.03, depth=0.04)
    cube('house body', (width, depth, height), (x, HOUSE_Y + depth / 2, base + height / 2), facade, bevel=0.03)
    cube('cornice', (width + 0.3, 0.4, 0.2), (x, HOUSE_Y - 0.05, base + height), M_FRAME)
    roof(x, width, base + height + 0.1, depth)
    cube('chimney', (0.6, 0.6, 1.6), (x + width * 0.25, HOUSE_Y + 2, base + height + width * 0.32), facade)
    cols = max(1, round(width / 2.2))
    for f in range(floors):
        for c in range(cols):
            wx = x - width / 2 + (c + 0.5) * (width / cols)
            wz = base + 1.35 + f * FLOOR
            if f == 0 and c == cols // 2:
                # an arched wooden door with iron rings
                cube('door', (1.1, 0.18, 2.05), (wx, HOUSE_Y - 0.14, base + 1.02), M_WOOD, bevel=0.02)
                for k in range(4):
                    cube('plank line', (0.02, 0.02, 1.9), (wx - 0.41 + k * 0.27, HOUSE_Y - 0.24, base + 1.02), M_JOINT, bevel=0)
                cube('door step', (1.5, 0.5, 0.14), (wx, HOUSE_Y - 0.4, base + 0.07), M_STEP)
                for s in (-1, 1):
                    bpy.ops.mesh.primitive_torus_add(major_radius=0.07, minor_radius=0.012, location=(wx + s * 0.18, HOUSE_Y - 0.25, base + 1.05), rotation=(math.pi / 2, 0, 0))
                    bpy.context.active_object.data.materials.append(M_IRON)
                continue
            window(wx, wz, shutter, planter=(f == 1 and not sign and rnd() < 0.7), balcony=(f == 2 and rnd() < 0.5), lit=rnd() < 0.3)
    if awning:
        # slopes down and out from the wall above the shop window
        bpy.ops.mesh.primitive_plane_add(size=1, location=(x, HOUSE_Y - 0.62, base + 2.62), rotation=(math.radians(24), 0, 0))
        aw = bpy.context.active_object; aw.scale = (width - 0.5, 1.25, 1); aw.data.materials.append(stripes(awning))
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        sol = aw.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = 0.03
    if sign:
        cube('sign board', (min(width - 0.6, 3.2), 0.08, 0.55), (x, HOUSE_Y - 0.32, base + 3.15), flat('sign', srgb('#1f3b33'), 0.5))
        bpy.ops.object.text_add(location=(x, HOUSE_Y - 0.37, base + 3.03), rotation=(math.pi / 2, 0, 0))
        t = bpy.context.active_object
        t.data.body = sign; t.data.align_x = 'CENTER'; t.data.size = 0.34; t.data.extrude = 0.01
        t.data.materials.append(flat('sign letters', srgb('#f1e3c2'), 0.4))


# ---------- foliage: leaf cards scattered over blobs ----------

leaf_me = bpy.data.meshes.new('leaf')
lbm = bmesh.new()
pts = [(0, 0, 0), (0.05, 0.0, 0.05), (0.03, 0, 0.12), (0, 0, 0.16), (-0.03, 0, 0.12), (-0.05, 0, 0.05)]
lv = [lbm.verts.new(p) for p in pts]
lbm.faces.new(lv)
lbm.to_mesh(leaf_me); lbm.free()


def leaves_blob(centre, radii, count, flowers=False, seed=0):
    """An ellipsoid of leaf cards (one mesh), each leaf tinted a little differently."""
    bm = bmesh.new()
    rl = bm.faces.layers.float.new('rand')
    src = [v.co.copy() for v in leaf_me.vertices]
    for i in range(count):
        # points on and just inside the ellipsoid, denser near the surface
        u, v_ = rnd() * 2 * math.pi, math.acos(2 * rnd() - 1)
        k = 0.75 + rnd() * 0.25
        p = Vector((math.sin(v_) * math.cos(u) * radii[0] * k, math.sin(v_) * math.sin(u) * radii[1] * k, math.cos(v_) * radii[2] * k))
        n = p.normalized()
        rot = n.to_track_quat('Z', 'Y').to_matrix().to_4x4() @ Matrix.Rotation(rnd() * 6.28, 4, 'Z') @ Matrix.Rotation(rnd() * 1.2 - 0.6, 4, 'X')
        s = 0.8 + rnd() * 0.7
        m = Matrix.Translation(Vector(centre) + p) @ rot @ Matrix.Diagonal((s, s, s, 1))
        f = bm.faces.new([bm.verts.new(m @ c) for c in src])
        f[rl] = rnd() * (0.72 if not flowers else 0.6)
    me = bpy.data.meshes.new('leaves'); bm.to_mesh(me); bm.free()
    me.materials.append(M_LEAF)
    ob = link(bpy.data.objects.new('leaves', me))
    if flowers:
        fl = Batch('flowers', flat('flowers', srgb(random.choice(['#e8546a', '#f2c94c', '#f4f0f0', '#d05ab0'])), 0.6), bevel=0)
        for i in range(12):
            fl.box((0.06, 0.06, 0.06), (centre[0] + (rnd() - 0.5) * radii[0] * 1.8, centre[1] - radii[1] * 0.9, centre[2] + rnd() * radii[2]))
        fl.done()
    return ob


def tree(x, y, s=1.0):
    bark = M_BARK
    # trunk and branches as tapered tubes
    def limb(points, r0, r1):
        cu = bpy.data.curves.new('limb', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 1; cu.bevel_resolution = 3
        sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(points) - 1)
        for i, p in enumerate(points):
            bp = sp.bezier_points[i]; bp.co = (x + p[0] * s, y + p[1] * s, p[2] * s + 1.34)
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
            bp.radius = (r0 + (r1 - r0) * i / (len(points) - 1)) * s
        ob = link(bpy.data.objects.new('limb', cu)); cu.materials.append(bark)
        return ob
    limb([(0, 0, 0), (0.15, 0, 1.5), (-0.1, 0.1, 3), (0, 0, 4)], 0.42, 0.2)
    for b in [[(0, 0, 3), (-1, 0.3, 4), (-1.9, 0.4, 4.9)], [(0, 0, 3.3), (1.1, -0.2, 4.3), (2, -0.3, 5)],
              [(0, 0, 3.8), (0.2, -0.9, 5), (0.3, -1.3, 5.8)], [(0, 0, 3.8), (-0.3, 0.9, 5.1), (-0.4, 1.2, 6)]]:
        limb(b, 0.16, 0.05)
    for cx, cy, cz, r in [(-1.9, 0.4, 5.1, 1.5), (2, -0.3, 5.2, 1.5), (0.3, -1.3, 6, 1.4), (-0.4, 1.2, 6.2, 1.4), (0, 0, 6.9, 1.7),
                          (-1.1, -0.9, 6.3, 1.1), (1.2, -0.8, 6.4, 1.1), (1, 1.4, 5.6, 1.1), (-1.4, 1.2, 5.6, 1.0), (0.4, -0.5, 7.6, 1.0)]:
        leaves_blob((x + cx * s, y + cy * s, 1.34 + cz * s), (r * s, r * s * 0.9, r * s * 0.85), int(900 * r * r))


# ---------- build the street ----------

hx = -9.0
for w, floors, extras in [(4.6, 3, {}), (5.2, 4, {'awning': '#c8423a', 'sign': 'Boulangerie'}), (4.2, 3, {}),
                          (5.6, 4, {'awning': '#2f6f8f', 'sign': 'Café du Port'}), (4.4, 3, {}), (5.0, 4, {'awning': '#4f8a3a', 'sign': 'Fleurs'}), (4.6, 3, {})]:
    HOUSE_Y = 4.2 + random.choice([0, 0.5, 1.1, 0.3, 0.8])  # houses step forward and back along the street
    house(hx + w / 2, w, floors, **extras)
    hx += w

tree(-11.5, 3.2, 1.0)
tree(9.5, 2.9, 0.85)  # a shade tree in front of the houses, throwing dappled shadows across them
for px in (-3.5, 6.5, 14.5):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.42, depth=0.7, location=(px, 2.6, 1.69), vertices=24)
    bpy.context.active_object.data.materials.append(M_POT)
    leaves_blob((px, 2.6, 2.4), (0.6, 0.6, 0.55), 700)

# lamp post
bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=4.2, location=(-1.5, -2.5, 2.1), vertices=16)
bpy.context.active_object.data.materials.append(M_IRON)
cube('lantern', (0.35, 0.35, 0.5), (-1.5, -2.5, 4.4), flat('lantern glass', srgb('#fff2c4'), 0.3, emit=srgb('#ffc070'), emit_strength=0), bevel=0.03)
lamp = bpy.data.lights.new('lamp light', 'POINT'); lamp.energy = 0; lamp.color = (1, 0.72, 0.42); lamp.shadow_soft_size = 0.2
lo = link(bpy.data.objects.new('lamp light', lamp)); lo.location = (-1.5, -2.7, 4.4)

# café: tables and red chairs
M_RED = pbr('red paint', 'distressed_painted_planks', scale=1.5, paint=srgb('#c8423a'), bump=0.2)
for tx in (5.0, 7.6):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=0.05, location=(tx, -1.6, 0.78), vertices=32)
    bpy.context.active_object.data.materials.append(flat('table top', srgb('#f3ece0'), 0.4))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.04, depth=0.76, location=(tx, -1.6, 0.4), vertices=12)
    bpy.context.active_object.data.materials.append(M_IRON)
    for side in (-1, 1):
        cx = tx + side * 0.75
        cube('seat', (0.48, 0.48, 0.05), (cx, -1.6, 0.48), M_RED, bevel=0.01)
        cube('back', (0.05, 0.48, 0.55), (cx + side * 0.22, -1.6, 0.78), M_RED, bevel=0.01)
        for lx, ly in ((-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)):
            cube('leg', (0.04, 0.04, 0.48), (cx + lx, -1.6 + ly, 0.24), M_RED, bevel=0.005)

# ---------- light: a real sunset sky photo (HDRI) lights everything; a sun lamp lines up with its sun ----------

import numpy as np

world = bpy.data.worlds.new('sunset'); scene.world = world
world.use_nodes = True
wn = world.node_tree
wn.nodes.clear()
hdri = bpy.data.images.load(os.path.join(TEX, 'kloofendal_48d_partly_cloudy_puresky_2k.hdr'))  # clear, sunny
env = wn.nodes.new('ShaderNodeTexEnvironment'); env.image = hdri
tc = wn.nodes.new('ShaderNodeTexCoord'); mp = wn.nodes.new('ShaderNodeMapping')
wn.links.new(tc.outputs['Generated'], mp.inputs['Vector']); wn.links.new(mp.outputs['Vector'], env.inputs['Vector'])
bg = wn.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 0.45  # blue sky light fills the shade
wo = wn.nodes.new('ShaderNodeOutputWorld')
wn.links.new(env.outputs['Color'], bg.inputs['Color'])
# the camera sees the sky at full brightness; for lighting it only gently fills the shade
lp = wn.nodes.new('ShaderNodeLightPath')
seen = wn.nodes.new('ShaderNodeBackground'); seen.inputs['Strength'].default_value = 1.0
wn.links.new(env.outputs['Color'], seen.inputs['Color'])
mixw = wn.nodes.new('ShaderNodeMixShader')
wn.links.new(lp.outputs['Is Camera Ray'], mixw.inputs['Fac'])
wn.links.new(bg.outputs['Background'], mixw.inputs[1]); wn.links.new(seen.outputs['Background'], mixw.inputs[2])
wn.links.new(mixw.outputs['Shader'], wo.inputs['Surface'])

# find the sun in the photo: its brightest pixel
w, h = hdri.size
px = np.empty(w * h * 4, dtype=np.float32); hdri.pixels.foreach_get(px)
px = px.reshape(h, w, 4)
lum = px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722
iy, ix = np.unravel_index(np.argmax(lum), lum.shape)
u, v = (ix + 0.5) / w, (iy + 0.5) / h
elev = math.radians(45)  # bright daytime  # a strong midday sun, high enough for crisp shadows under sills, awnings and pots
az_photo = math.pi - 2 * math.pi * u                      # Blender's equirect: atan2(y, -x) = pi - 2*pi*u
sun_rgb = px[iy, ix, :3] / max(px[iy, ix, :3].max(), 1e-6)

# where we want it: low on the left, a little in front of the houses, so it rakes across them
want = Vector((-0.62, -0.78, 0)).normalized()  # in front and to the left: facades fully lit, shadows falling right
az_want = math.atan2(want.y, -want.x)
mp.inputs['Rotation'].default_value = (0, 0, az_photo - az_want)
sun_dir = Vector((want.x * math.cos(elev), want.y * math.cos(elev), math.sin(elev))).normalized()

sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 7.5; sun.angle = math.radians(1.0)
sun.color = (1.0, 0.93, 0.82)  # warm sunlight; the blue sky fills the shade
so = link(bpy.data.objects.new('sun', sun))
so.rotation_euler = sun_dir.to_track_quat('Z', 'Y').to_euler()
print('SUN elev %.1f°' % math.degrees(elev), 'colour', tuple(round(float(c), 2) for c in sun.color))

# ---------- camera: square-on to the houses, a little depth of field ----------

cam = bpy.data.cameras.new('camera'); cam.lens = 30
cam.dof.use_dof = True; cam.dof.aperture_fstop = 5.6; cam.dof.focus_distance = 19.5
co = link(bpy.data.objects.new('camera', cam))
co.location = (4.5, -15.5, 3.4)
co.rotation_euler = Euler((math.radians(90 + 4), 0, 0))
scene.camera = co

# ---------- render settings ----------

scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'
except TypeError:
    try:
        scene.view_settings.look = 'Punchy'
    except TypeError:
        pass
scene.view_settings.exposure = 0.35
scene.render.filepath = OUT

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'village.blend'))
bpy.ops.render.render(write_still=True)
print('RENDERED', OUT)
