extends RefCounted

# This helper is copied into an isolated Web export. It embeds the geographic
# route in the existing simulation terrain; it never changes that terrain or
# plans around request-specific risk events. Supply the base obstacle snapshot.
const GRID_DIVISIONS := 48
const REFINEMENT_ROUNDS := 5
const EPSILON := 0.000001


static func choose_mapping(start: Vector3, destination: Vector3, obstacle_data: Dictionary, clearance_margin: float) -> Dictionary:
	var report := {
		"schemaVersion": "godot-web-coordinate-mapping.v1",
		"ok": false,
		"mode": "unavailable",
		"reason": "invalid_geometry",
		"offset": {"x": 0.0, "z": 0.0},
		"candidateCount": 0,
		"gridDivisions": GRID_DIVISIONS,
		"selection": "minimum_translation_among_deterministic_candidates",
	}
	if not start.is_finite() or not destination.is_finite() or not is_finite(clearance_margin) or clearance_margin < 0.0:
		return report
	var raw_boundary: Variant = obstacle_data.get("boundary_half_extent")
	if not _finite_number(raw_boundary) or float(raw_boundary) <= clearance_margin:
		report.reason = "invalid_or_insufficient_navigation_boundary"
		return report
	var boundary := float(raw_boundary)
	var geometry := _parse_geometry(obstacle_data, clearance_margin)
	if not geometry.ok:
		report.reason = geometry.reason
		return report
	var original := Vector2(start.x, start.z)
	var end := Vector2(destination.x, destination.z)
	var delta := end - original
	var inner_boundary := boundary - clearance_margin
	report.merge({
		"marginMeters": clearance_margin,
		"boundaryHalfExtent": boundary,
		"originalStart": _point(start),
		"originalDestination": _point(destination),
		"routeLengthMeters": delta.length(),
		"baseRockCount": geometry.rocks.size(),
		"baseBoxCount": geometry.boxes.size(),
	})
	var state := {"found": false, "offset": Vector2.ZERO, "distanceSquared": INF, "count": 0}
	_consider(original, end, Vector2.ZERO, inner_boundary, geometry, state)
	if not state.found:
		# Both translated endpoints must stay in the same convex inner boundary.
		var lower := Vector2(-inner_boundary - minf(delta.x, 0.0), -inner_boundary - minf(delta.y, 0.0))
		var upper := Vector2(inner_boundary - maxf(delta.x, 0.0), inner_boundary - maxf(delta.y, 0.0))
		if lower.x > upper.x or lower.y > upper.y:
			report.reason = "route_exceeds_navigation_boundary"
			report.candidateCount = state.count
			return report
		var xs: Array[float] = [clampf(original.x, lower.x, upper.x)]
		var zs: Array[float] = [clampf(original.y, lower.y, upper.y)]
		for index in range(GRID_DIVISIONS + 1):
			xs.append(lerpf(lower.x, upper.x, float(index) / GRID_DIVISIONS))
			zs.append(lerpf(lower.y, upper.y, float(index) / GRID_DIVISIONS))
		for x in xs:
			for z in zs:
				_consider(original, end, Vector2(x, z) - original, inner_boundary, geometry, state)
		if state.found:
			# Refine only around the best feasible grid candidate. This remains a
			# finite deterministic search, not a claim of a global optimum.
			var step := (upper - lower) / GRID_DIVISIONS
			for _round in range(REFINEMENT_ROUNDS):
				step *= 0.5
				var center: Vector2 = state.offset
				for dx in [-1, 0, 1]:
					for dz in [-1, 0, 1]:
						_consider(original, end, center + Vector2(dx * step.x, dz * step.y), inner_boundary, geometry, state)
	report.candidateCount = state.count
	if not state.found:
		report.reason = "no_safe_translation_in_search_grid"
		return report
	var offset: Vector2 = state.offset
	var translation := Vector3(offset.x, 0.0, offset.y)
	report.merge({
		"ok": true,
		"mode": "original" if offset == Vector2.ZERO else "translated",
		"reason": "base_terrain_segment_clear",
		"offset": {"x": offset.x, "z": offset.y},
		"translationMeters": offset.length(),
		"mappedStart": _point(start + translation),
		"mappedDestination": _point(destination + translation),
	}, true)
	return report


static func _consider(start: Vector2, destination: Vector2, offset: Vector2, boundary: float, geometry: Dictionary, state: Dictionary) -> void:
	state.count += 1
	var distance := offset.length_squared()
	if state.found and distance >= float(state.distanceSquared):
		return
	var a := start + offset
	var b := destination + offset
	if maxf(absf(a.x), absf(b.x)) > boundary or maxf(absf(a.y), absf(b.y)) > boundary:
		return
	var segment := b - a
	var length_squared := segment.length_squared()
	for rock: Vector3 in geometry.rocks:
		var center := Vector2(rock.x, rock.y)
		var t := clampf((center - a).dot(segment) / length_squared, 0.0, 1.0) if length_squared > 0.0 else 0.0
		if center.distance_squared_to(a + segment * t) <= rock.z * rock.z:
			return
	for rectangle: Rect2 in geometry.boxes:
		if _segment_intersects_box(a, b, rectangle):
			return
	state.found = true
	state.offset = offset
	state.distanceSquared = distance


static func _segment_intersects_box(a: Vector2, b: Vector2, rectangle: Rect2) -> bool:
	# Slab clipping checks the entire segment, including points inside a box and
	# tangential contact. Endpoint-only tests miss thin obstacles in the middle.
	var delta := b - a
	var enter := 0.0
	var leave := 1.0
	for axis in range(2):
		if absf(delta[axis]) <= EPSILON:
			if a[axis] < rectangle.position[axis] or a[axis] > rectangle.end[axis]:
				return false
		else:
			var first := (rectangle.position[axis] - a[axis]) / delta[axis]
			var second := (rectangle.end[axis] - a[axis]) / delta[axis]
			enter = maxf(enter, minf(first, second))
			leave = minf(leave, maxf(first, second))
			if enter > leave:
				return false
	return true


static func _parse_geometry(data: Dictionary, margin: float) -> Dictionary:
	var result := {"ok": false, "reason": "invalid_base_obstacle_geometry", "rocks": [], "boxes": []}
	if not data.get("rocks", []) is Array or not data.get("boxes", []) is Array:
		return result
	for raw: Variant in data.get("rocks", []):
		if not raw is Dictionary:
			return result
		var position: Variant = raw.get("position")
		var radius: Variant = raw.get("radius")
		if not position is Vector3 or not position.is_finite() or not _finite_number(radius) or float(radius) < 0.0:
			return result
		result.rocks.append(Vector3(position.x, position.z, float(radius) + margin))
	for raw: Variant in data.get("boxes", []):
		if not raw is Dictionary:
			return result
		var position: Variant = raw.get("position")
		var size: Variant = raw.get("size")
		if not position is Vector3 or not position.is_finite() or not size is Vector3 or not size.is_finite() or size.x < 0.0 or size.z < 0.0:
			return result
		var half := Vector2(size.x, size.z) * 0.5 + Vector2.ONE * margin
		result.boxes.append(Rect2(Vector2(position.x, position.z) - half, half * 2.0))
	result.ok = true
	return result


static func _finite_number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))


static func _point(value: Vector3) -> Dictionary:
	return {"x": value.x, "y": value.y, "z": value.z}
