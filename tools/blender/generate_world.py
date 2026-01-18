"""
WorldWeaver Blender generation stub.
This runs offline via MCP or a backend worker; never in the browser.
"""

import argparse
import sys
import time

import bpy


def log(message: str):
    print(f"[WW] {message}", flush=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def create_material(name: str, color: tuple):
    """Create a material with the specified color."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    return mat


def generate_world(prompt: str):
    log("Clearing scene")
    clear_scene()

    log("Blocking out base terrain")
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "WW_Ground"
    
    # Add green grass material to ground
    ground_material = create_material("Ground_Material", (0.2, 0.6, 0.3))
    ground.data.materials.append(ground_material)
    time.sleep(0.3)

    log("Placing proxy geometry")
    bpy.ops.mesh.primitive_cube_add(size=2, location=(4, 0, 1))
    block_a = bpy.context.active_object
    block_a.name = "WW_Block_A"
    
    # Add brown material to block A
    block_a_material = create_material("BlockA_Material", (0.6, 0.4, 0.2))
    block_a.data.materials.append(block_a_material)
    
    bpy.ops.mesh.primitive_cube_add(size=2, location=(-4, 0, 1))
    block_b = bpy.context.active_object
    block_b.name = "WW_Block_B"
    
    # Add blue material to block B
    block_b_material = create_material("BlockB_Material", (0.2, 0.4, 0.8))
    block_b.data.materials.append(block_b_material)
    time.sleep(0.3)

    # Example prompt metadata stored on the scene for exporters to read.
    bpy.context.scene["ww_prompt"] = prompt


def export_glb(output_path: str):
    log("Exporting GLB")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
    )


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", type=str, default="Default WorldWeaver prompt")
    parser.add_argument("--output", type=str, default="/tmp/worldweaver_generated.glb")

    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()

    generate_world(args.prompt)
    export_glb(args.output)
    log(f"Exported GLB to {args.output}")

