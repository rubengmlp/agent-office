"""Convierte un personaje de Mixamo y sus animaciones a un GLB para Agent Office.

Uso (Blender 3.6 o superior, sin interfaz):

    blender -b -P tools/fbx2glb.py -- personaje.fbx salida.glb idle=Idle.fbx walk=Walking.fbx sit=Sitting.fbx \
        type=Typing.fbx talk=Talking.fbx wave=Waving.fbx think=Thinking.fbx

El personaje se descarga de Mixamo en FBX Binary con piel ("With Skin") y cada animación en FBX Binary
sin piel ("Without Skin"), todas con el mismo esqueleto de Mixamo. Cada animación queda en el GLB como
un clip con el nombre que va antes del signo igual.
"""

import os
import sys

import bpy


def fail(message):
    print(f"fbx2glb: {message}", file=sys.stderr)
    sys.exit(1)


def parse_args():
    if "--" not in sys.argv:
        fail("faltan argumentos: blender -b -P tools/fbx2glb.py -- personaje.fbx salida.glb clip=animacion.fbx ...")
    args = sys.argv[sys.argv.index("--") + 1:]
    if len(args) < 3:
        fail("hacen falta el personaje, el GLB de salida y al menos una animación clip=fichero.fbx")
    character, output, *pairs = args
    clips = []
    for pair in pairs:
        name, sep, path = pair.partition("=")
        if not sep or not name or not path:
            fail(f"'{pair}' no tiene la forma clip=fichero.fbx")
        clips.append((name, path))
    for path in [character] + [p for _, p in clips]:
        if not os.path.isfile(path):
            fail(f"no existe {path}")
    return character, output, clips


def armatures():
    return [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]


def import_fbx(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=True)
    return [o for o in bpy.context.scene.objects if o not in before]


def main():
    character, output, clips = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_fbx(character)
    rigs = armatures()
    if len(rigs) != 1:
        fail(f"el personaje tiene {len(rigs)} esqueletos; se espera uno")
    rig = rigs[0]
    rig.animation_data_create()
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    for name, path in clips:
        imported = import_fbx(path)
        source = next((o for o in imported if o.type == "ARMATURE" and o.animation_data and o.animation_data.action), None)
        if source is None:
            fail(f"{path} no trae ninguna animación")
        action = source.animation_data.action
        action.name = name
        action.use_fake_user = True
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        start = int(action.frame_range[0])
        track.strips.new(name, start, action)
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)

    rig.animation_data.action = None
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    options = dict(filepath=output, export_format="GLB", export_animations=True, export_skins=True)
    try:
        bpy.ops.export_scene.gltf(**options, export_animation_mode="NLA_TRACKS")
    except TypeError:
        bpy.ops.export_scene.gltf(**options, export_nla_strips=True)
    print(f"fbx2glb: {output} con {len(clips)} clips: {', '.join(n for n, _ in clips)}")


main()
