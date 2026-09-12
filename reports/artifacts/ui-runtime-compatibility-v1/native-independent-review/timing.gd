extends SceneTree
var milestones: Dictionary = {}
var clock_zero: int = Time.get_ticks_msec()
var bridge: Node
var elapsed: float = 0.0
var review_directory := OS.get_environment("NATIVE_REVIEW_DIR")
func _initialize() -> void:
	milestones.initialize = Time.get_ticks_msec() - clock_zero
	call_deferred("run")
func run() -> void:
	milestones.beforeLoad = Time.get_ticks_msec() - clock_zero
	var packed = load(ProjectSettings.get_setting("application/run/main_scene"))
	milestones.afterLoad = Time.get_ticks_msec() - clock_zero
	var scene = packed.instantiate()
	milestones.afterInstantiate = Time.get_ticks_msec() - clock_zero
	bridge = scene.get_node("MalaccaValidationBridge")
	bridge.auto_poll_request_file = false
	bridge.finalize_immediately_in_headless = false
	bridge.result_file_path = review_directory.path_join("raw-result.json")
	bridge.validation_result_written.connect(on_result)
	root.add_child(scene)
	milestones.afterSceneReady = Time.get_ticks_msec() - clock_zero
	call_deferred("submit")
func submit() -> void:
	milestones.beforeSubmit = Time.get_ticks_msec() - clock_zero
	bridge.process_validation_payload(FileAccess.get_file_as_string(review_directory.path_join("request.json")))
func on_result(result: Dictionary) -> void:
	if result.get("status") == "running":
		milestones.running = Time.get_ticks_msec() - clock_zero
		return
	milestones.result = Time.get_ticks_msec() - clock_zero
	var file = FileAccess.open(review_directory.path_join("timing.json"), FileAccess.WRITE)
	file.store_string(JSON.stringify({"engine":Engine.get_version_info().string,"mode":"headless_actual_pck","milestonesMs":milestones,"simulatedDurationSeconds":result.get("simulatedDurationSeconds"),"resultStatus":result.get("status"),"safePass":result.get("safePass"),"minClearanceMeters":result.get("minClearanceMeters"),"note":"Headless startup timing does not measure native GPU/window readiness."}, "\t"))
	file.close()
	print("NATIVE_TIMING=",JSON.stringify(milestones))
	call_deferred("quit")
func _process(delta: float) -> bool:
	elapsed += delta
	if elapsed > 30.0:
		quit(1)
	return false
