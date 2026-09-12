#!/usr/bin/env python3
"""Validate an export before publication and record source/artifact provenance."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def sha256(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(source, *args):
    return subprocess.check_output(["git", "-C", str(source), *args], text=True).strip()


def source_provenance(source):
    keys = ["project.godot", "main.tscn", "scripts/integration/malacca_validation_bridge.gd", "scripts/audio/ship_ambient_audio.gd", "export_presets.cfg"]
    return {
        "gitSha": git(source, "rev-parse", "HEAD"),
        "gitTree": git(source, "rev-parse", "HEAD^{tree}"),
        "commitDate": git(source, "log", "-1", "--format=%cI"),
        "dirty": bool(git(source, "status", "--porcelain")),
        "keyFiles": {name: sha256(source / name) for name in keys if (source / name).is_file()},
    }


def patch_once(source, anchor, replacement):
    if source.count(anchor) != 1:
        raise ValueError("Validation bridge source changed; review the Web coordinate compatibility patch before exporting")
    return source.replace(anchor, replacement, 1)


def prepare_coordinate_bridge(source_copy):
    relative = "scripts/integration/malacca_validation_bridge.gd"
    bridge_file = source_copy / relative
    if not bridge_file.is_file():
        return []
    original = bridge_file.read_text()
    source = patch_once(original, "class_name MalaccaValidationBridge\n", "class_name MalaccaValidationBridge\n\nconst WEB_COORDINATE_MAPPER = preload(\"res://scripts/integration/malacca_web_coordinate_mapper.gd\")\nvar _web_coordinate_offset := Vector3.ZERO\nvar _web_coordinate_mapping: Dictionary = {}\n")
    source = patch_once(source, "\t_reset_validation_scene()\n\n\tvar ship := _find_or_create_ship(request)", "\t_reset_validation_scene()\n\t_validation_elapsed = 0.0\n\t_collision_count = 0\n\t_grounding_count = 0\n\t_last_collision_active = false\n\t_min_clearance_meters = 1.0e9\n\n\tif not _prepare_web_coordinate_mapping(request):\n\t\tvar mapping_failure := _failure_result(request, \"无法在当前真实地形内安全嵌入完整验证航段；未执行航行。\")\n\t\t_write_validation_result(mapping_failure)\n\t\treturn mapping_failure\n\n\tvar ship := _find_or_create_ship(request)")
    source = patch_once(source, "\treturn origin.lerp(destination, progress)\n", "\treturn origin.lerp(destination, progress) + _web_coordinate_offset\n")
    source = patch_once(source, "\tvar destination := _endpoint_to_world(_dictionary_value(request, \"destination\"), start_position + Vector3(96.0, 0.0, -96.0))\n", "\tvar mapped_destination: Dictionary = _web_coordinate_mapping.get(\"mappedDestination\", {})\n\tvar destination := Vector3(float(mapped_destination.x), float(mapped_destination.y), float(mapped_destination.z))\n")
    source = patch_once(source, "\t\t\"temporaryObstacleCount\": _temporary_obstacle_count\n", "\t\t\"temporaryObstacleCount\": _temporary_obstacle_count,\n\t\t\"coordinateMapping\": _web_coordinate_mapping.duplicate(true)\n")
    source = patch_once(source, "\t_apply_temporary_obstacles_from_request(request, route_points)\n", "\t_apply_temporary_obstacles_from_request(request, route_points)\n\t_web_coordinate_mapping[\"riskObstaclesAppliedAfterMapping\"] = true\n")
    source += '''

func _prepare_web_coordinate_mapping(request: Dictionary) -> bool:
\t_web_coordinate_offset = Vector3.ZERO
\t_web_coordinate_mapping = {}
\tif _obstacle_system == null or not _obstacle_system.has_method("get_radar_obstacle_data"):
\t\t_web_coordinate_mapping = {"ok": false, "reason": "Current scene obstacle geometry is unavailable"}
\t\treturn false
\tvar origin := _endpoint_to_world(_dictionary_value(request, "origin"), Vector3.ZERO)
\tvar destination := _endpoint_to_world(_dictionary_value(request, "destination"), origin + Vector3(96.0, 0.0, -96.0))
\tvar speed_profile := _dictionary_value(request, "speedProfile")
\t# The existing spawn adapter passes maxSafeKnots directly as the engine speed
\t# limit. Reserve that conservative bound for motion during the finite window.
\tvar window_drift := maxf(_float_value(speed_profile, "maxSafeKnots", 18.0), 0.1) * maxf(validation_duration_seconds, 0.2)
\tvar clearance_margin := SAFE_CLEARANCE_METERS + 3.2 + window_drift
\tvar base_obstacles: Dictionary = _obstacle_system.call("get_radar_obstacle_data")
\t_web_coordinate_mapping = WEB_COORDINATE_MAPPER.choose_mapping(origin, destination, base_obstacles, clearance_margin)
\t_web_coordinate_mapping["originalProgressPercent"] = clampf(_float_value(request, "progressPercent", 0.0), 0.0, 100.0)
\t_web_coordinate_mapping["riskObstaclesAppliedAfterMapping"] = false
\t_web_coordinate_mapping["geographicCalibrationVerified"] = false
\tif not bool(_web_coordinate_mapping.get("ok", false)):
\t\treturn false
\tvar offset: Dictionary = _web_coordinate_mapping.get("offset", {})
\t_web_coordinate_offset = Vector3(float(offset.get("x", 0.0)), 0.0, float(offset.get("z", 0.0)))
\treturn true
'''
    before = sha256(bridge_file)
    bridge_file.write_text(source)
    mapper_relative = "scripts/integration/malacca_web_coordinate_mapper.gd"
    mapper_file = source_copy / mapper_relative
    mapper_source = Path(__file__).with_name("godot_web_coordinate_mapper.gd")
    mapper_file.write_bytes(mapper_source.read_bytes())
    return [
        {
            "id": "terrain-aware-coordinate-embedding-v1",
            "file": relative,
            "beforeSha256": before,
            "afterSha256": sha256(bridge_file),
            "reason": "Embed the unchanged route direction, length and progress into a safe corridor using current scene terrain, before adding the original risk obstacles.",
        },
        {"id": "terrain-aware-coordinate-mapper-v1", "file": mapper_relative, "beforeSha256": None, "afterSha256": sha256(mapper_file)},
    ]


def prepare_web_variant(source_copy):
    """Apply auditable Web compatibility changes only to the export copy."""
    relative = "scripts/audio/ship_ambient_audio.gd"
    audio_file = source_copy / relative
    patches = []
    if audio_file.is_file():
        original = audio_file.read_text()
        anchor = "func _make_generator_player(channel_name: String, volume_db: float) -> void:\n\tvar audio_player := AudioStreamPlayer.new()\n"
        if original.count(anchor) != 1:
            raise ValueError("Ambient audio source changed; review the Web Stream compatibility patch before exporting")
        before = sha256(audio_file)
        audio_file.write_text(original.replace(anchor, anchor + "\taudio_player.playback_type = AudioServer.PLAYBACK_TYPE_STREAM\n", 1))
        patches.append({
            "id": "procedural-ambient-audio-stream-v1",
            "file": relative,
            "beforeSha256": before,
            "afterSha256": sha256(audio_file),
            "reason": "The four AudioStreamGenerator channels require Stream playback; Web Sample playback cannot generate their frames.",
        })
    patches.extend(prepare_coordinate_bridge(source_copy))
    return {"executionScope": "isolated-source-copy", "patches": patches}


def validate(directory, provenance_file, engine_version, preset, web_variant_file):
    html = (directory / "index.html").read_text()
    match = re.search(r"const\s+GODOT_CONFIG\s*=\s*(\{[^\n]+\})\s*;", html)
    if not match:
        raise ValueError("Godot bootstrap configuration is missing")
    config = json.loads(match.group(1))
    if config.get("executable") != "index":
        raise ValueError("Expected the index export entrypoint")
    core_files = ["index.html", "index.js", "index.pck", "index.wasm"]
    artifacts = {}
    for name in core_files:
        file = directory / name
        size = file.stat().st_size
        if size <= 0:
            raise ValueError(f"Export resource is empty: {name}")
        expected = config.get("fileSizes", {}).get(name)
        if name.endswith((".pck", ".wasm")) and expected != size:
            raise ValueError(f"Export size does not match its bootstrap: {name}")
        artifacts[name] = {"bytes": size, "sha256": sha256(file)}
    with (directory / "index.pck").open("rb") as stream:
        if stream.read(4) != b"GDPC":
            raise ValueError("The PCK header is invalid")
    with (directory / "index.wasm").open("rb") as stream:
        if stream.read(4) != b"\x00asm":
            raise ValueError("The WebAssembly header is invalid")
    compatibility = json.loads(web_variant_file.read_text())
    coordinate_validation = None
    if any(patch["id"] == "terrain-aware-coordinate-embedding-v1" for patch in compatibility["patches"]):
        evidence_file = directory / "coordinate-validation.json"
        evidence = json.loads(evidence_file.read_text())
        if evidence.get("passed") is not True or evidence.get("headlessImmediateFinalization") is not False or len(evidence.get("cases", [])) != 3 or evidence.get("mappingInvariantChecks", 0) < 10:
            raise ValueError("The exported PCK did not pass its actual coordinate regression")
        coordinate_validation = {"file": evidence_file.name, "sha256": sha256(evidence_file), "caseCount": len(evidence["cases"]), "headlessImmediateFinalization": False, "mappingInvariantChecks": evidence["mappingInvariantChecks"], "requestFixtureSha256": sha256(Path(__file__).with_name("godot_web_coordinate_request.json")), "verifierSha256": sha256(Path(__file__).with_name("verify_godot_web_coordinates.gd"))}
    manifest = {
        "schemaVersion": "godot-web-export-manifest.v1",
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "engineVersion": engine_version,
        "exportPreset": preset,
        "source": json.loads(provenance_file.read_text()),
        "sourceIsolatedBeforeImport": True,
        "webCompatibility": compatibility,
        "coordinateValidation": coordinate_validation,
        "artifacts": artifacts,
        "authority": {"simulationMode": True, "productionAuthority": False},
    }
    (directory / "export-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"GODOT_WEB_EXPORT:PASS:{manifest['source']['gitSha']}:dirty={manifest['source']['dirty']}")


if __name__ == "__main__":
    if sys.argv[1] == "--source":
        Path(sys.argv[3]).write_text(json.dumps(source_provenance(Path(sys.argv[2])), ensure_ascii=False) + "\n")
    elif sys.argv[1] == "--has-coordinate-patch":
        patches = json.loads(Path(sys.argv[2]).read_text())["patches"]
        sys.exit(0 if any(patch["id"] == "terrain-aware-coordinate-embedding-v1" for patch in patches) else 1)
    elif sys.argv[1] == "--prepare-web":
        Path(sys.argv[3]).write_text(json.dumps(prepare_web_variant(Path(sys.argv[2])), ensure_ascii=False) + "\n")
    else:
        validate(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4], Path(sys.argv[5]))
