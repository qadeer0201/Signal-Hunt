"""Lightweight static checks for local HTML references and deployment YAML."""
import re
from pathlib import Path
import yaml

root = Path(__file__).resolve().parent
for name in ("render.yaml",):
    value = yaml.safe_load((root / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict) and value.get("services"), f"invalid YAML: {name}"
    print(f"YAML PASS: {name}")

for relative in ("Frontend/index.html", "Frontend/host.html"):
    page = root / relative
    html = page.read_text(encoding="utf-8")
    ids = re.findall(r'\bid="([^"]+)', html)
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    refs = re.findall(r'(?:src|href)="([^"]+)', html)
    missing = []
    for ref in refs:
        if ref.startswith(("http", "#", "mailto:")):
            continue
        local = ref.split("?", 1)[0].split("#", 1)[0]
        target = page.parent / local.lstrip("/") if local.startswith("/") else page.parent / local
        if not target.exists():
            missing.append(ref)
    assert not duplicates, f"duplicate IDs in {relative}: {duplicates}"
    assert not missing, f"missing local references in {relative}: {missing}"
    print(f"HTML PASS: {relative}, {len(ids)} IDs, {len(refs)} local references checked")
