extends SceneTree
const Mapper = preload("res://scripts/integration/malacca_web_coordinate_mapper.gd")
const Bridge = preload("res://scripts/integration/malacca_validation_bridge.gd")
class Obstacles extends Node:
	var boundary := 780.0
	func get_radar_obstacle_data() -> Dictionary:
		return {"boundary_half_extent": boundary, "rocks": [], "boxes": []}
var results: Array[Dictionary] = []
func check(name: String, actual: bool, detail: Variant = null) -> void:
	results.append({"name": name, "pass": actual, "detail": detail})
func _initialize() -> void:
	call_deferred("run")
func run() -> void:
	var empty = {"boundary_half_extent": 100.0, "rocks": [], "boxes": []}
	var original = Mapper.choose_mapping(Vector3(-20, -140, 3), Vector3(30, -140, 9), empty, 2.0)
	check("original_clear_segment", original.ok and original.mode == "original", original)
	var thin = {"boundary_half_extent":100.0, "rocks":[], "boxes":[{"position":Vector3(0,0,0), "size":Vector3(0.01,1,20)}]}
	var translated = Mapper.choose_mapping(Vector3(-40,0,0), Vector3(40,0,0), thin, 2.0)
	check("thin_midpoint_box_requires_translation", translated.ok and translated.mode == "translated", translated)
	var a = Vector3(translated.mappedStart.x,translated.mappedStart.y,translated.mappedStart.z)
	var b = Vector3(translated.mappedDestination.x,translated.mappedDestination.y,translated.mappedDestination.z)
	check("translation_preserves_direction_length_progress", (b-a).is_equal_approx(Vector3(80,0,0)) and a.lerp(b,0.37).is_equal_approx(Vector3(-40,0,0).lerp(Vector3(40,0,0),0.37)+Vector3(translated.offset.x,0,translated.offset.z)))
	var rocks = {"boundary_half_extent":100.0, "rocks":[{"position":Vector3(0,0,0), "radius":10.0}], "boxes":[]}
	check("circle_tangent_requires_translation", Mapper.choose_mapping(Vector3(-40,0,12),Vector3(40,0,12),rocks,2.0).mode=="translated")
	check("box_tangent_is_intersection", Mapper._segment_intersects_box(Vector2(-2,1),Vector2(2,1),Rect2(-1,-1,2,2)))
	check("box_parallel_disjoint", not Mapper._segment_intersects_box(Vector2(-2,1.001),Vector2(2,1.001),Rect2(-1,-1,2,2)))
	check("box_zero_length_inside", Mapper._segment_intersects_box(Vector2(0,0),Vector2(0,0),Rect2(-1,-1,2,2)))
	check("box_zero_length_outside", not Mapper._segment_intersects_box(Vector2(2,0),Vector2(2,0),Rect2(-1,-1,2,2)))
	check("boundary_exact_margin_is_feasible", Mapper.choose_mapping(Vector3(-98,0,0),Vector3(98,0,0),empty,2.0).ok)
	check("route_too_long_fails", not Mapper.choose_mapping(Vector3(-99,0,0),Vector3(99,0,0),empty,2.0).ok)
	var filled = {"boundary_half_extent":100.0, "rocks":[], "boxes":[{"position":Vector3.ZERO,"size":Vector3(200,2,200)}]}
	check("no_solution_fails", not Mapper.choose_mapping(Vector3(-1,0,0),Vector3(1,0,0),filled,2.0).ok)
	check("invalid_geometry_fails", not Mapper.choose_mapping(Vector3.ZERO,Vector3.ONE,{"boundary_half_extent":100.0,"rocks":[{"position":Vector3.ZERO,"radius":-1.0}]},2.0).ok)
	check("nonfinite_endpoint_fails", not Mapper.choose_mapping(Vector3(INF,0,0),Vector3.ONE,empty,2.0).ok)
	var bridge = Bridge.new()
	bridge.auto_poll_request_file = false
	bridge.result_file_path = "user://godot-coordinate-independent-review-last-result.json"
	var obstacle = Obstacles.new()
	obstacle.name="ShipNavigationObstacles"
	root.add_child(obstacle)
	root.add_child(bridge)
	var request = {"requestId":"fallback","vesselId":"probe","progressPercent":50.0}
	bridge._prepare_web_coordinate_mapping(request)
	var start = bridge._validation_start_position(request)
	var ship = Node3D.new()
	root.add_child(ship)
	ship.global_position = start
	var route = bridge._apply_route_from_request(request,ship)
	check("fallback_destination_matches_full_segment",route[1].is_equal_approx(Vector3(96,-140.73494,-96)),{"start":str(start),"destination":str(route[1]),"expectedDestination":"(96,-140.73494,-96)"})
	var zero_route: Array[Vector3] = [Vector3(-40,-140,2),Vector3(40,-140,16)]
	var shifted_route: Array[Vector3] = [zero_route[0]+Vector3(200,0,-123),zero_route[1]+Vector3(200,0,-123)]
	for event_type in ["channel-closure","collision-risk","port-paralysis","extreme-weather"]:
		var event = {"type":event_type,"severity":"danger"}
		var rocks0: Array[Vector3] = []
		var rocks1: Array[Vector3] = []
		var boxes0: Array[Dictionary] = []
		var boxes1: Array[Dictionary] = []
		bridge._append_temporary_obstacles_for_event(event,0,1,zero_route,rocks0,boxes0)
		bridge._append_temporary_obstacles_for_event(event,0,1,shifted_route,rocks1,boxes1)
		var exact = rocks0.size()==rocks1.size() and boxes0.size()==boxes1.size()
		for i in range(rocks0.size()):
			exact = exact and (rocks1[i]-rocks0[i]).is_equal_approx(Vector3(200,0,-123))
		for i in range(boxes0.size()):
			exact = exact and (boxes1[i].position-boxes0[i].position).is_equal_approx(Vector3(200,0,-123)) and boxes1[i].size==boxes0[i].size
		check("risk_obstacles_translate_once_"+event_type,exact)
	obstacle.boundary = 1.0
	bridge._collision_count = 4
	bridge._grounding_count = 2
	var failure = bridge.apply_validation_request({"requestId":"unavailable", "vesselId":"probe"})
	check("mapping_failure_does_not_reuse_prior_collision_counts",failure.collisionCount==0 and failure.groundingCount==0,failure)
	print("INDEPENDENT_MAPPER_REVIEW=",JSON.stringify(results))
	var file=FileAccess.open("user://godot-coordinate-independent-review-results.json",FileAccess.WRITE)
	file.store_string(JSON.stringify(results,"\t"));file.close()
	quit()
