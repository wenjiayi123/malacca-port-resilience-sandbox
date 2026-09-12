extends SceneTree

# Run against the actual exported PCK, with immediate headless completion off:
# godot --headless --main-pack public/godot-simulator/index.pck --script <this-file>
#   -- --request=<request-json> --output=<evidence-json>
var elapsed := 0.0
var bridge: Node
var requests: Array[Dictionary] = []
var results: Array[Dictionary] = []
var request_index := 0
var output_path := ""
var first_offset: Dictionary = {}
var mapping_checks := 0
var checking_bridge_invariants := true

func _initialize() -> void:
	call_deferred("run_validation")

func run_validation() -> void:
	if not check_mapper_geometry():
		return
	var request_path := ""
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--request="):
			request_path = argument.trim_prefix("--request=")
		elif argument.begins_with("--output="):
			output_path = argument.trim_prefix("--output=")
	if request_path.is_empty() or output_path.is_empty():
		fail_validation("Both --request and --output are required")
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(request_path))
	if not parsed is Dictionary:
		fail_validation("The request fixture must be a JSON object")
		return
	var normal: Dictionary = parsed.duplicate(true)
	normal.requestId = "coordinate-check-normal"
	normal.riskEvents = []
	requests.append(normal)
	var original: Dictionary = parsed.duplicate(true)
	original.requestId = "coordinate-check-original-risk"
	requests.append(original)
	var blocked: Dictionary = normal.duplicate(true)
	blocked.requestId = "coordinate-check-injected-closure"
	blocked.progressPercent = 99.0
	blocked.riskEvents = [{"id": "coordinate-regression-closure", "type": "channel-closure", "severity": "danger", "label": "Injected closure regression", "expectedDurationMinutes": 30.0}]
	requests.append(blocked)
	var packed: PackedScene = load(ProjectSettings.get_setting("application/run/main_scene"))
	var scene := packed.instantiate()
	bridge = scene.get_node("MalaccaValidationBridge")
	bridge.auto_poll_request_file = false
	bridge.finalize_immediately_in_headless = false
	bridge.result_file_path = output_path + ".last-result.json"
	bridge.validation_result_written.connect(on_result)
	root.add_child(scene)
	if not check_bridge_invariants(normal):
		return
	checking_bridge_invariants = false
	call_deferred("next_request")

func next_request() -> void:
	if request_index >= requests.size():
		var file := FileAccess.open(output_path, FileAccess.WRITE)
		if file == null:
			fail_validation("Cannot write coordinate validation evidence")
			return
		file.store_string(JSON.stringify({"schemaVersion": "godot-web-coordinate-validation.v1", "engineVersion": Engine.get_version_info().string, "headlessImmediateFinalization": false, "passed": true, "mappingInvariantChecks": mapping_checks, "cases": results}, "\t"))
		file.close()
		print("GODOT_WEB_COORDINATES:PASS:", results.size())
		quit()
		return
	bridge.process_validation_payload(JSON.stringify(requests[request_index]))

func on_result(result: Dictionary) -> void:
	if checking_bridge_invariants:
		return
	if result.get("status", "running") == "running":
		return
	print("COORDINATE_RESULT=", JSON.stringify(result))
	var loaded: Dictionary = result.get("loadedScene", {})
	var mapping: Dictionary = loaded.get("coordinateMapping", {})
	if not bool(mapping.get("ok", false)) or not bool(mapping.get("riskObstaclesAppliedAfterMapping", false)):
		fail_validation("The exported bridge did not report a valid terrain mapping")
		return
	if float(result.get("simulatedDurationSeconds", 0.0)) < 2.0:
		fail_validation("The real simulation window did not run")
		return
	if request_index == 0:
		if result.status != "passed" or not bool(result.get("safePass", false)) or int(loaded.get("temporaryObstacleCount", -1)) != 0:
			fail_validation("The no-risk route did not pass in the current terrain")
			return
		first_offset = mapping.get("offset", {}).duplicate(true)
	elif mapping.get("offset", {}) != first_offset:
		fail_validation("Risk or progress changes unexpectedly moved the route coordinate frame")
		return
	if request_index == 2 and (not result.status in ["failed", "degraded"] or int(loaded.get("temporaryObstacleCount", 0)) < 1):
		fail_validation("The injected near-destination closure was not rejected by the real simulation")
		return
	results.append(result.duplicate(true))
	request_index += 1
	call_deferred("next_request")

func fail_validation(reason: String) -> void:
	push_error("GODOT_WEB_COORDINATES:FAIL:" + reason)
	quit(1)

func _process(delta: float) -> bool:
	elapsed += delta
	if elapsed > 60.0:
		fail_validation("Timed out waiting for the current PCK")
	return false


func check_mapper_geometry() -> bool:
	var mapper = load("res://scripts/integration/malacca_web_coordinate_mapper.gd")
	if mapper == null:
		fail_validation("The exported coordinate mapper is missing")
		return false
	var a := Vector3(-30.0, -140.0, 0.0)
	var b := Vector3(30.0, -140.0, 0.0)
	var clear_geometry := {"boundary_half_extent": 100.0, "rocks": [], "boxes": []}
	var clear: Dictionary = mapper.choose_mapping(a, b, clear_geometry, 10.0)
	if not bool(clear.get("ok", false)) or clear.get("mode") != "original" or clear.get("offset") != {"x": 0.0, "z": 0.0}:
		fail_validation("An already safe route must keep its original coordinates")
		return false
	mapping_checks += 1
	var thin: Dictionary = clear_geometry.duplicate(true)
	thin.boxes = [{"position": Vector3.ZERO, "size": Vector3(0.1, 8.0, 10.0)}]
	var translated: Dictionary = mapper.choose_mapping(a, b, thin, 10.0)
	if not bool(translated.get("ok", false)) or translated.get("mode") != "translated" or absf(float(translated.offset.z)) < 15.0:
		fail_validation("A thin obstacle between safe endpoints must block the entire segment")
		return false
	var start: Dictionary = translated.mappedStart
	var destination: Dictionary = translated.mappedDestination
	if absf(float(destination.x) - float(start.x) - 60.0) > 0.0001 or absf(float(destination.z) - float(start.z)) > 0.0001 or start.y != -140.0 or destination.y != -140.0:
		fail_validation("Mapping changed the full route length, direction or height")
		return false
	mapping_checks += 2
	var repeated: Dictionary = mapper.choose_mapping(a, b, thin, 10.0)
	if repeated.offset != translated.offset:
		fail_validation("Coordinate mapping must be deterministic")
		return false
	mapping_checks += 1
	var blocked: Dictionary = clear_geometry.duplicate(true)
	blocked.boxes = [{"position": Vector3.ZERO, "size": Vector3(200.0, 8.0, 200.0)}]
	if bool(mapper.choose_mapping(a, b, blocked, 10.0).get("ok", false)):
		fail_validation("An impossible corridor must fail instead of changing terrain")
		return false
	mapping_checks += 1
	if bool(mapper.choose_mapping(Vector3(-200.0, 0.0, 0.0), Vector3(200.0, 0.0, 0.0), clear_geometry, 10.0).get("ok", false)):
		fail_validation("A route longer than the boundary must not be shortened")
		return false
	mapping_checks += 1
	for malformed: Dictionary in [{"boundary_half_extent": NAN}, {"boundary_half_extent": 100.0, "rocks": [{"position": Vector3.ZERO, "radius": INF}]}]:
		if bool(mapper.choose_mapping(a, b, malformed, 10.0).get("ok", false)):
			fail_validation("Malformed geometry must fail closed")
			return false
		mapping_checks += 1
	return true


func check_bridge_invariants(normal: Dictionary) -> bool:
	var missing: Dictionary = normal.duplicate(true)
	missing.requestId = "coordinate-check-missing-endpoint-fallback"
	missing.origin = {}
	missing.destination = {}
	missing.progressPercent = 50.0
	var running: Dictionary = bridge.apply_validation_request(missing)
	var mapping: Dictionary = running.get("loadedScene", {}).get("coordinateMapping", {})
	if running.get("status") != "running" or not bool(mapping.get("ok", false)):
		fail_validation("Fallback bridge route did not start")
		return false
	var route: Array = bridge.get("_route_points")
	var mapped_start: Dictionary = mapping.mappedStart
	var mapped_end: Dictionary = mapping.mappedDestination
	var expected_start := Vector3(float(mapped_start.x), float(mapped_start.y), float(mapped_start.z)).lerp(Vector3(float(mapped_end.x), float(mapped_end.y), float(mapped_end.z)), 0.5)
	var expected_end := Vector3(float(mapped_end.x), float(mapped_end.y), float(mapped_end.z))
	if route.size() != 2 or not route[0].is_equal_approx(expected_start) or not route[1].is_equal_approx(expected_end):
		fail_validation("Fallback bridge route changed its checked destination or progress")
		return false
	mapping_checks += 1
	bridge.set("_collision_count", 4)
	bridge.set("_grounding_count", 2)
	bridge.set("_validation_elapsed", 1.0)
	var original_window: float = bridge.validation_duration_seconds
	bridge.validation_duration_seconds = 10000.0
	var impossible: Dictionary = bridge.apply_validation_request(normal)
	bridge.validation_duration_seconds = original_window
	if impossible.get("status") != "failed" or bool(impossible.get("safePass", true)) or int(impossible.get("collisionCount", -1)) != 0 or int(impossible.get("groundingCount", -1)) != 0 or float(impossible.get("simulatedDurationSeconds", -1.0)) != 0.0:
		fail_validation("Mapping failure reused the preceding request's physics counters")
		return false
	mapping_checks += 1
	return true
