#!/usr/bin/env python3
"""
Relax Chromium's single NSS_3.30 symbol-version requirement to NSS_3.22.

WHY: @sparticuz/chromium (Chrome 153) links libnss3.so and requires version
NSS_3.30 for exactly one symbol, PK11_HasAttributeSet. The only NSS build
obtainable in this network-restricted sandbox (bundled in the PyPI `kaleido`
wheel) provides version definitions up to NSS_3.22. Everything else Chromium
needs - including NSS_SetAlgorithmPolicy@NSSUTIL_3.12.3 from libnssutil3.so -
is satisfied by that build.

HOW: locate the Elf64_Vernaux entry in .gnu.version_r whose hash matches
elf_hash(FROM) and whose .dynstr name really is FROM, then rewrite both the
hash and the name string to TO (identical byte length, so nothing relocates).
The missing symbol itself is supplied at runtime by nss_compat_shim.so via
LD_PRELOAD.

Dependency-free (parses the ELF64 section table itself) and idempotent.
usage: patch_nss_version.py <src-binary> <dst-binary> [from_ver] [to_ver]
"""
import os
import shutil
import stat
import struct
import sys

SHT_GNU_VERNEED = 0x6FFFFFFE  # noqa: F841  (kept for documentation value)


def elf_hash(name: str) -> int:
    """Classic SysV ELF hash, as used by Elf64_Vernaux.vna_hash."""
    h = 0
    for c in name.encode():
        h = ((h << 4) + c) & 0xFFFFFFFF
        g = h & 0xF0000000
        if g:
            h ^= g >> 24
        h &= ~g & 0xFFFFFFFF
    return h


def sections(f):
    """Map section name -> {type, offset, size} from the ELF64 section table."""
    f.seek(0)
    assert f.read(4) == b"\x7fELF", "not an ELF file"
    f.seek(0x28)
    (e_shoff,) = struct.unpack("<Q", f.read(8))
    f.seek(0x3A)
    e_shentsize, e_shnum, e_shstrndx = struct.unpack("<HHH", f.read(6))
    f.seek(e_shoff + e_shstrndx * e_shentsize + 0x18)  # +0x18 -> sh_offset
    shstr_off, shstr_size = struct.unpack("<QQ", f.read(16))
    f.seek(shstr_off)
    shstr = f.read(shstr_size)
    out = {}
    for i in range(e_shnum):
        f.seek(e_shoff + i * e_shentsize)
        name, typ, _flags, _addr, off, size, _link, _info, _al, _es = struct.unpack(
            "<IIQQQQIIQQ", f.read(64))
        out[shstr[name:shstr.index(b"\0", name)].decode()] = dict(type=typ, offset=off, size=size)
    return out


def main(src: str, dst: str, FROM: str = "NSS_3.30", TO: str = "NSS_3.22") -> int:
    assert len(FROM) == len(TO), "replacement version must be the same byte length"
    shutil.copyfile(src, dst)
    mode = os.stat(src).st_mode
    os.chmod(dst, mode | stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    with open(dst, "r+b") as f:
        secs = sections(f)
        dynstr, verneed = secs[".dynstr"], secs[".gnu.version_r"]
        f.seek(dynstr["offset"])
        ds = f.read(dynstr["size"])
        f.seek(verneed["offset"])
        vn = f.read(verneed["size"])
        needle = struct.pack("<I", elf_hash(FROM))
        patched = 0
        for off in range(0, len(vn) - 15, 4):
            if vn[off:off + 4] != needle:
                continue
            _h, _flags, _other, vna_name, _next = struct.unpack_from("<IHHII", vn, off)
            if ds[vna_name:ds.index(b"\0", vna_name)].decode() != FROM:
                continue
            f.seek(dynstr["offset"] + vna_name)
            f.write(TO.encode() + b"\0")
            f.seek(verneed["offset"] + off)
            f.write(struct.pack("<I", elf_hash(TO)))
            patched += 1
        if patched == 0:
            alt = struct.pack("<I", elf_hash(TO))
            already = 0
            for off in range(0, len(vn) - 15, 4):
                if vn[off:off + 4] != alt:
                    continue
                _h, _f2, _o, vna_name, _n = struct.unpack_from("<IHHII", vn, off)
                if ds[vna_name:ds.index(b"\0", vna_name)].decode() == TO:
                    already += 1
        else:
            already = 0
        f.flush()
    print(f"[patch-nss] {FROM}->{TO}: patched={patched} already={already}")
    if patched == 0 and already == 0:
        print("[patch-nss] FAILED: no matching verneed entry found")
        return 3
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    sys.exit(main(args[0], args[1], *(args[2:4] if len(args) > 3 else [])))
