#!/usr/bin/env python3
"""Build a deterministic, credential-free school plugin ZIP outside the checkout."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import sys
import zipfile


CHECKOUT = Path(__file__).resolve().parent.parent
SOURCE = CHECKOUT / "plugins" / "system-school"
FILES = (
    ".codex-plugin/plugin.json",
    "README.md",
    "references/CHATGPT_SETUP.md",
    "references/chatgpt-openapi.yaml",
    "skills/system-school/SKILL.md",
    "skills/system-school/scripts/school_api.py",
)
CREDENTIAL = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    r"|(?:soa_|sor_|soc_|scs_)[A-Za-z0-9_-]{43}"
    r"|sb_secret_[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9]{20,}"
    r"|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}"
)


def archive(source):
    """Validate the exact public allowlist before creating any output bytes."""
    source = Path(source)
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Package root must be a regular directory")
    found = set()
    for entry in source.rglob("*"):
        mode = entry.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise ValueError("Package must not contain links or special files")
        if stat.S_ISREG(mode):
            found.add(entry.relative_to(source).as_posix())
    if found != set(FILES):
        raise ValueError("Package must contain exactly the six public allowlisted files")
    payloads = {}
    for name in FILES:
        data = (source / name).read_bytes()
        if len(data) > 1024 * 1024:
            raise ValueError("Package file exceeds the size limit")
        text = data.decode("utf-8")
        if CREDENTIAL.search(text):
            raise ValueError("A package file contains a credential; no archive was written")
        payloads[name] = data
    manifest = json.loads(payloads[".codex-plugin/plugin.json"])
    if manifest.get("name") != "system-school" or manifest.get("skills") != "./skills/":
        raise ValueError("Unexpected plugin manifest")
    if "apps" in manifest or "mcpServers" in manifest:
        raise ValueError("Unverified app or MCP registration is not supported")
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=False) as bundle:
        for name in sorted(payloads):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info, payloads[name], compresslevel=9)
    data = stream.getvalue()
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        if bundle.testzip() is not None or set(bundle.namelist()) != set(FILES):
            raise ValueError("Archive integrity check failed")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="New ZIP path outside this Git checkout")
    output = parser.parse_args().out.resolve()
    if output == CHECKOUT or CHECKOUT in output.parents:
        raise ValueError("Write generated ZIPs outside the Git checkout")
    data = archive(SOURCE)
    # Exclusive creation prevents replacing another release or user file.
    with output.open("xb") as handle:
        handle.write(data)
    print(json.dumps({"file": str(output), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "entries": len(FILES)}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError):
        print("Plugin packaging failed validation; no credentials or file contents are displayed.", file=sys.stderr)
        sys.exit(1)
