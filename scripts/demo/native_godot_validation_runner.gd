extends SceneTree

var result_path := ""
var status_path := ""
var request_path := ""
var finished := false
var lease_path := ""
var lease_elapsed := 0.0
var last_valid_lease := 0.0
var script_started_at := 0.0
var scene_ready_at := 0.0

func _initialize() -> void:
	script_started_at = Time.get_unix_time_from_system()
	last_valid_lease = script_started_at * 1000.0
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--request="): request_path = argument.trim_prefix("--request=")
		elif argument.begins_with("--result="): result_path = argument.trim_prefix("--result=")
		elif argument.begins_with("--status="): status_path = argument.trim_prefix("--status=")
		elif argument.begins_with("--lease="): lease_path = argument.trim_prefix("--lease=")
	if not request_path.is_absolute_path() or not result_path.is_absolute_path() or not status_path.is_absolute_path() or not lease_path.is_absolute_path():
		push_error("NATIVE_GODOT_VALIDATION: absolute owned job paths are required")
		quit(1)
		return
	call_deferred("start_validation")

func start_validation() -> void:
	var payload := FileAccess.get_file_as_string(request_path)
	var request: Variant = JSON.parse_string(payload)
	if not request is Dictionary:
		push_error("NATIVE_GODOT_VALIDATION: invalid request")
		quit(1)
		return
	var packed: PackedScene = load(ProjectSettings.get_setting("application/run/main_scene"))
	var scene := packed.instantiate()
	var bridge: Node = scene.get_node("MalaccaValidationBridge")
	# These are set before _ready, so the original user:// request is never polled.
	bridge.auto_poll_request_file = false
	bridge.finalize_immediately_in_headless = false
	bridge.request_file_path = request_path
	bridge.result_file_path = result_path
	bridge.validation_result_written.connect(on_result)
	root.add_child(scene)
	current_scene = scene
	root.title = "马六甲 · 独立单船验证 · " + str(request.get("vesselName", ""))
	var ready_file := FileAccess.open(status_path, FileAccess.WRITE)
	if ready_file == null:
		push_error("NATIVE_GODOT_VALIDATION: cannot write ready status")
		quit(1)
		return
	scene_ready_at = Time.get_unix_time_from_system()
	ready_file.store_string(JSON.stringify({"readyAtUnixSeconds": scene_ready_at, "status": "running", "requestId": request.get("requestId"), "displayDriver": DisplayServer.get_name(), "projectTitle": ProjectSettings.get_setting("application/config/name")}))
	ready_file.close()
	bridge.process_validation_payload(payload)

func on_result(result: Dictionary) -> void:
	if result.get("status", "running") == "running": return
	finished = true
	var result_at := Time.get_unix_time_from_system()
	print("NATIVE_GODOT_VALIDATION:RESULT:", JSON.stringify(result))
	root.title = "马六甲 · 验证结果 " + str(result.get("status")) + " · " + str(result.get("vesselId"))
	var captured := false
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		var frame := root.get_texture().get_image()
		captured = frame.save_png(result_path.get_base_dir().path_join("scene.png")) == OK
	var metrics := FileAccess.open(result_path.get_base_dir().path_join("native-runtime.json"), FileAccess.WRITE)
	if metrics != null:
		metrics.store_string(JSON.stringify({"displayDriver": DisplayServer.get_name(), "scriptStartedAtUnixSeconds": script_started_at, "sceneReadyAtUnixSeconds": scene_ready_at, "resultAtUnixSeconds": result_at, "sceneScreenshotCaptured": captured}))
		metrics.close()
	# Keep the native window available for scene inspection. The server owns its
	# child process and closes it on explicit cancellation or the next validation.


func _process(delta: float) -> bool:
	lease_elapsed += delta
	if lease_elapsed >= 2.0:
		lease_elapsed = 0.0
		var lease := FileAccess.get_file_as_string(lease_path).to_int()
		if lease > 0: last_valid_lease = maxf(last_valid_lease, float(lease))
		if Time.get_unix_time_from_system() * 1000.0 - last_valid_lease > 15000.0:
			print("NATIVE_GODOT_VALIDATION: owning service lease expired")
			quit()
	return false
