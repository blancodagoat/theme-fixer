"""Builds map.json from two decrypted Discord IPAs.

    pip install hermes-dec==0.1.7
    python tools/build_map.py Discord_305.1.ipa Discord_345.0.ipa

The old IPA should be 305.1, the last version that ships both the old and
the new color names. The new IPA is whatever version the site targets.
"""

import io
import json
import logging
import plistlib
import sys
import zipfile
from pathlib import Path

from hermes_dec.parsers.hbc_bytecode_parser import parse_hbc_bytecode
from hermes_dec.parsers.hbc_file_parser import HBCReader
from hermes_dec.parsers.serialized_literal_parser import unpack_slp_array

logging.disable(logging.WARNING)

ROOT = Path(__file__).resolve().parent.parent
THEMES = ("DARK", "LIGHT", "MIDNIGHT", "DARKER")
PROBE = "BACKGROUND_BASE_LOWER"


def open_ipa(path):
    with zipfile.ZipFile(path) as z:
        bundle = z.read("Payload/Discord.app/main.jsbundle")
        version = plistlib.loads(z.read("Payload/Discord.app/Info.plist"))["CFBundleShortVersionString"]
    reader = HBCReader()
    reader.read_whole_file(io.BytesIO(bundle))
    return reader, version


def find_token_module(r):
    probe = r.strings.index(PROBE)
    shapes = set()
    if r.header.version >= 97:
        shapes = {i for i, keys in enumerate(r.object_shape_keys) if f"'{PROBE}'" in keys}
    for fi, fh in enumerate(r.function_headers):
        for ins in parse_hbc_bytecode(fh, r):
            if ins.inst.name == "PutById" and ins.arg4 == probe:
                return fi
            if ins.inst.name.startswith("NewObjectWithBuffer") and r.header.version >= 97 and ins.arg2 in shapes:
                return fi
    sys.exit(f"couldn't find the color token module in bytecode v{r.header.version}")


def read_array_tokens(r, fi):
    """v96 layout: table[names.TOKEN] = [Color.X, Color.Y, ...], one entry per theme."""
    reg, tables = {}, {}
    for ins in parse_hbc_bytecode(r.function_headers[fi], r):
        n = ins.inst.name
        if n in ("NewObject", "NewArray"):
            reg[ins.arg1] = ("obj", ins.original_pos, {}) if n == "NewObject" else ("arr", [])
        elif n in ("GetById", "GetByIdShort", "GetByIdLong"):
            src, name = reg.get(ins.arg2), r.strings[ins.arg4]
            if name == "Color":
                reg[ins.arg1] = ("color",)
            elif src and src[0] == "color":
                reg[ins.arg1] = ("raw", name)
            else:
                reg[ins.arg1] = ("prop", name)
        elif n == "PutOwnByIndex":
            arr, val = reg.get(ins.arg1), reg.get(ins.arg2)
            if arr and arr[0] == "arr" and val and val[0] == "raw":
                arr[1].append(val[1])
        elif n == "PutOwnByVal":
            obj, val, key = reg.get(ins.arg1), reg.get(ins.arg2), reg.get(ins.arg3)
            if obj and obj[0] == "obj" and val and val[0] == "arr" and key and key[0] == "prop":
                tables.setdefault(obj[1], {})[key[1]] = tuple(val[1])
        elif ins.inst.operands and ins.inst.operands[0].operand_type.name.startswith("Reg") and not n.startswith("Put"):
            reg[ins.arg1] = None
    return max(tables.values(), key=len)


def read_shape_tokens(r, fi):
    """v97+ layout: tokens = {TOKEN: {category, [Themes.DARK]: {raw, opacity}, ...}, ...}."""

    def literal(ins):
        keys = [k.strip("'") for k in r.object_shape_keys[ins.arg2]]
        values = unpack_slp_array(r.literal_values[ins.arg3:], len(keys), r.header.version).to_strings(r.strings)
        return dict(zip(keys, (v.strip("'") for v in values)))

    reg, objs, tables = {}, {}, {}
    for ins in parse_hbc_bytecode(r.function_headers[fi], r):
        n = ins.inst.name
        if n.startswith("NewObjectWithBuffer"):
            objs[ins.original_pos] = {"lit": literal(ins), "keys": [k.strip("'") for k in r.object_shape_keys[ins.arg2]], "themes": {}}
            reg[ins.arg1] = ins.original_pos
        elif n in ("GetById", "GetByIdShort", "GetByIdLong"):
            reg[ins.arg1] = r.strings[ins.arg4]
        elif n == "DefineOwnByVal":
            obj, val, key = reg.get(ins.arg1), reg.get(ins.arg2), reg.get(ins.arg3)
            if isinstance(obj, int) and isinstance(val, int) and key in THEMES:
                objs[obj]["themes"][key] = objs[val]["lit"]
        elif n.startswith("PutOwnBySlotIdx"):
            obj, val = reg.get(ins.arg1), reg.get(ins.arg2)
            if isinstance(obj, int) and isinstance(val, int):
                themes = objs[val]["themes"]
                if all(t in themes for t in THEMES):
                    tables.setdefault(obj, {})[objs[obj]["keys"][ins.arg3]] = tuple(normalize(themes[t]) for t in THEMES)
        elif ins.inst.operands and ins.inst.operands[0].operand_type.name.startswith("Reg") and not n.startswith(("Put", "Define")):
            reg[ins.arg1] = None
    return max(tables.values(), key=len)


def normalize(color):
    raw, opacity = color["raw"], float(color["opacity"])
    return raw if opacity == 1 or raw.startswith("OPACITY_") else f"{raw}@{opacity:g}"


def read_tokens(path):
    r, version = open_ipa(path)
    fi = find_token_module(r)
    tokens = read_array_tokens(r, fi) if r.header.version < 97 else read_shape_tokens(r, fi)
    print(f"{version}: bytecode v{r.header.version}, {len(tokens)} color tokens (function #{fi})")
    return tokens, version


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    old, _ = read_tokens(sys.argv[1])
    new, version = read_tokens(sys.argv[2])
    pairs = json.loads((ROOT / "tools" / "pairs.json").read_text())

    mapping = {}
    for src, targets in pairs.items():
        if src in new:
            print(f"note: {src} still exists in {version}")
        if src not in old:
            print(f"warning: {src} isn't in the old build, can't check it")
        entries = []
        for dst in targets:
            if dst not in new:
                print(f"warning: dropping {src} -> {dst}, {dst} doesn't exist in {version}")
                continue
            reference = old.get(dst) or new[dst]
            entries.append({"name": dst, "exact": old.get(src) == reference})
        if entries:
            mapping[src] = entries

    out = {"discord": version, "tokens": sorted(new), "map": mapping}
    (ROOT / "map.json").write_text(json.dumps(out, indent=1) + "\n")
    exact = sum(e["exact"] for v in mapping.values() for e in v)
    total = sum(len(v) for v in mapping.values())
    print(f"wrote map.json: {len(mapping)} old names, {total} targets, {exact} exact")


if __name__ == "__main__":
    main()
