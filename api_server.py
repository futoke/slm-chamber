from __future__ import annotations

import base64
import json
import mimetypes
import os
import uuid
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parent
SNAPSHOT_DIR = ROOT_DIR / "snapshots"
SNAPSHOT_DIR.mkdir(exist_ok=True)


def default_grid_params() -> Dict[str, Any]:
    return {"grid": {"cols": 12, "rows": 12}, "cross_size": 0.18, "image_size": {"width": 960, "height": 1280}, "points": [], "shifted_point_id": 0}


def default_camera_params() -> Dict[str, Any]:
    return {"image_size": {"width": 960, "height": 1280}, "coefficients": {"k1": -0.12, "k2": 0.02, "p1": 0.0, "p2": 0.0, "k3": 0.0}}


def default_scan_params() -> Dict[str, Any]:
    return {"enabled": True, "distortion_type": "barrel", "strength": 0.34, "coefficients": {"k1": -0.34, "k2": 0.0612, "p1": 0.0, "p2": 0.0, "k3": -0.0136}}


def apply_opencv_distortion(x: float, y: float, coefficients: Dict[str, float]) -> Dict[str, float]:
    k1 = float(coefficients.get("k1", 0.0))
    k2 = float(coefficients.get("k2", 0.0))
    p1 = float(coefficients.get("p1", 0.0))
    p2 = float(coefficients.get("p2", 0.0))
    k3 = float(coefficients.get("k3", 0.0))
    r2 = (x * x) + (y * y)
    radial = 1 + (k1 * r2) + (k2 * r2 * r2) + (k3 * r2 * r2 * r2)
    x_tan = (2 * p1 * x * y) + (p2 * (r2 + (2 * x * x)))
    y_tan = (p1 * (r2 + (2 * y * y))) + (2 * p2 * x * y)
    return {"x": (x * radial) + x_tan, "y": (y * radial) + y_tan}


@dataclass
class AppState:
    running: bool = False
    speed: float = 1.0
    active_view: str = "free"
    last_snapshot_id: str | None = None
    grid_params: Dict[str, Any] = field(default_factory=default_grid_params)
    camera_params: Dict[str, Any] = field(default_factory=default_camera_params)
    scan_params: Dict[str, Any] = field(default_factory=default_scan_params)
    camera_position: Dict[str, Any] = field(default_factory=lambda: {"arc_angle": 0.0, "arc_elevation": 0.0, "position": {"x": 0.0, "y": 6.15, "z": 4.9}, "look_at": {"x": 0.0, "y": 0.48, "z": 0.0}})

    def ui_state(self) -> Dict[str, Any]:
        return {
            "gridCols": int(self.grid_params.get("grid", {}).get("cols", 0)),
            "gridRows": int(self.grid_params.get("grid", {}).get("rows", 0)),
            "crossSize": float(self.grid_params.get("cross_size", 0.18)),
            "scannerDistortionType": self.scan_params.get("distortion_type", "none"),
            "scannerDistortionStrength": float(self.scan_params.get("strength", 0.0)),
            "cameraDistortion": self.camera_params.get("coefficients", {}),
            "cameraArcAngle": float(self.camera_position.get("arc_angle", 0.0)),
            "cameraArcElevation": float(self.camera_position.get("arc_elevation", 0.0)),
            "speed": self.speed,
            "running": self.running,
            "activeView": self.active_view,
            "lastSnapshotId": self.last_snapshot_id,
        }

    def config(self) -> Dict[str, Any]:
        return {
            "running": self.running,
            "speed": self.speed,
            "grid": self.grid_params,
            "camera": self.camera_params,
            "scanner": self.scan_params,
            "camera_position": self.camera_position,
            "ui": self.ui_state(),
            "exports": {
                "scene": self.grid_params,
                "scanner": self.scan_params,
                "camera": self.camera_params,
            },
        }


APP_STATE = AppState()

COEFF_SCHEMA = {
    "type": "object",
    "description": "OpenCV-style distortion coefficients.",
    "required": ["k1", "k2", "p1", "p2", "k3"],
    "properties": {
        "k1": {"type": "number", "description": "First radial coefficient."},
        "k2": {"type": "number", "description": "Second radial coefficient."},
        "p1": {"type": "number", "description": "First tangential coefficient."},
        "p2": {"type": "number", "description": "Second tangential coefficient."},
        "k3": {"type": "number", "description": "Third radial coefficient."},
    },
}

OPENAPI_SPEC: Dict[str, Any] = {
    "openapi": "3.0.3",
    "info": {
        "title": "SLM Chamber API",
        "version": "1.0.0",
        "description": "API for scene configuration, camera/scanner distortion parameters, simulation control and snapshots.",
    },
    "servers": [{"url": "/"}],
    "components": {
        "schemas": {
            "ImageSize": {"type": "object", "required": ["width", "height"], "properties": {"width": {"type": "integer", "description": "Image width in pixels.", "example": 960}, "height": {"type": "integer", "description": "Image height in pixels.", "example": 1280}}},
            "GridShape": {"type": "object", "required": ["cols", "rows"], "properties": {"cols": {"type": "integer", "description": "Number of columns.", "example": 6}, "rows": {"type": "integer", "description": "Number of rows.", "example": 9}}},
            "DistortionCoefficients": COEFF_SCHEMA,
            "GridPoint": {
                "type": "object",
                "required": ["id", "color_bgr", "shifted", "position", "original_position", "shift_vector"],
                "properties": {
                    "id": {"type": "integer", "description": "Point identifier.", "example": 0},
                    "color_bgr": {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "integer"}, "description": "Point color in BGR.", "example": [0, 0, 255]},
                    "shifted": {"type": "boolean", "description": "Whether distortion moved the point.", "example": True},
                    "position": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}, "description": "Distorted position in pixels.", "example": [102.68969120300136, 130.58980190864736]},
                    "original_position": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}, "description": "Undistorted position in pixels.", "example": [164.82758620689657, 214.48275862068965]},
                    "shift_vector": {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}, "description": "Difference between distorted and original positions.", "example": [-62.13789500389521, -83.89295671204229]},
                },
            },
            "GridParams": {
                "type": "object",
                "required": ["grid", "cross_size", "image_size", "points", "shifted_point_id"],
                "properties": {
                    "grid": {"$ref": "#/components/schemas/GridShape"},
                    "cross_size": {"type": "number", "description": "Cross marker size in scene units.", "example": 0.18},
                    "image_size": {"$ref": "#/components/schemas/ImageSize"},
                    "points": {"type": "array", "description": "Exported grid points.", "items": {"$ref": "#/components/schemas/GridPoint"}},
                    "shifted_point_id": {"type": "integer", "description": "Highlighted shifted point id.", "example": 16},
                },
            },
            "ScannerParams": {
                "type": "object",
                "required": ["enabled", "distortion_type", "strength", "coefficients"],
                "properties": {
                    "enabled": {"type": "boolean", "description": "Enables scanner distortion.", "example": True},
                    "distortion_type": {"type": "string", "description": "Named UI distortion mode.", "enum": ["none", "barrel", "pincushion"], "example": "barrel"},
                    "strength": {"type": "number", "description": "UI distortion strength.", "example": 0.34},
                    "coefficients": {"$ref": "#/components/schemas/DistortionCoefficients"},
                },
            },
            "CameraParams": {"type": "object", "required": ["image_size", "coefficients"], "properties": {"image_size": {"$ref": "#/components/schemas/ImageSize"}, "coefficients": {"$ref": "#/components/schemas/DistortionCoefficients"}}},
            "Vector3": {"type": "object", "required": ["x", "y", "z"], "properties": {"x": {"type": "number", "description": "X coordinate.", "example": 0.0}, "y": {"type": "number", "description": "Y coordinate.", "example": 6.15}, "z": {"type": "number", "description": "Z coordinate.", "example": 4.9}}},
            "CameraPosition": {"type": "object", "required": ["arc_angle", "arc_elevation", "position", "look_at"], "properties": {"arc_angle": {"type": "number", "description": "Horizontal orbit angle in degrees.", "example": 0}, "arc_elevation": {"type": "number", "description": "Vertical orbit angle in degrees.", "example": 0}, "position": {"$ref": "#/components/schemas/Vector3"}, "look_at": {"$ref": "#/components/schemas/Vector3"}}},
            "Point2D": {"type": "object", "required": ["x", "y"], "properties": {"x": {"type": "number", "description": "Normalized x coordinate.", "example": 0.2}, "y": {"type": "number", "description": "Normalized y coordinate.", "example": -0.1}}},
            "GridDistortRequest": {"type": "object", "required": ["coefficients", "points"], "properties": {"coefficients": {"$ref": "#/components/schemas/DistortionCoefficients"}, "points": {"type": "array", "description": "Normalized points for distortion.", "items": {"$ref": "#/components/schemas/Point2D"}}}},
            "SnapshotUpload": {"type": "object", "required": ["image_base64"], "properties": {"id": {"type": "string", "description": "Optional custom snapshot id.", "example": "snapshot-001"}, "image_base64": {"type": "string", "description": "PNG image as data URL.", "example": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."}}},
            "SnapshotCreated": {"type": "object", "required": ["id", "path"], "properties": {"id": {"type": "string", "description": "Snapshot identifier.", "example": "snapshot-001"}, "path": {"type": "string", "description": "PNG download endpoint.", "example": "/api/snapshot/snapshot-001"}, "ui": {"$ref": "#/components/schemas/UiState"}}},
            "UiState": {
                "type": "object",
                "properties": {
                    "gridCols": {"type": "integer", "example": 12},
                    "gridRows": {"type": "integer", "example": 12},
                    "crossSize": {"type": "number", "example": 0.18},
                    "scannerDistortionType": {"type": "string", "example": "barrel"},
                    "scannerDistortionStrength": {"type": "number", "example": 0.34},
                    "cameraDistortion": {"$ref": "#/components/schemas/DistortionCoefficients"},
                    "cameraArcAngle": {"type": "number", "example": 0},
                    "cameraArcElevation": {"type": "number", "example": 0},
                    "speed": {"type": "number", "example": 1.0},
                    "running": {"type": "boolean", "example": True},
                    "activeView": {"type": "string", "example": "free"},
                    "lastSnapshotId": {"type": "string", "nullable": True, "example": "snapshot-001"},
                },
            },
            "StatusResponse": {"type": "object", "properties": {"ok": {"type": "boolean", "example": True}, "running": {"type": "boolean", "example": False}, "reset": {"type": "boolean", "example": True}, "deleted": {"type": "string", "example": "snapshot-001"}, "speed": {"type": "number", "example": 1.0}, "ui": {"$ref": "#/components/schemas/UiState"}}},
            "ErrorResponse": {"type": "object", "required": ["error"], "properties": {"error": {"type": "string", "example": "Snapshot not found"}}},
            "ConfigResponse": {"type": "object", "required": ["running", "speed", "grid", "camera", "scanner", "camera_position", "ui", "exports"], "properties": {"running": {"type": "boolean", "description": "Whether simulation is active.", "example": False}, "speed": {"type": "number", "description": "Simulation speed multiplier.", "example": 1.0}, "grid": {"$ref": "#/components/schemas/GridParams"}, "camera": {"$ref": "#/components/schemas/CameraParams"}, "scanner": {"$ref": "#/components/schemas/ScannerParams"}, "camera_position": {"$ref": "#/components/schemas/CameraPosition"}, "ui": {"$ref": "#/components/schemas/UiState"}, "exports": {"type": "object", "properties": {"scene": {"$ref": "#/components/schemas/GridParams"}, "scanner": {"$ref": "#/components/schemas/ScannerParams"}, "camera": {"$ref": "#/components/schemas/CameraParams"}}}}},
            "GridDistortResponse": {"type": "object", "required": ["points", "coefficients"], "properties": {"points": {"type": "array", "items": {"$ref": "#/components/schemas/Point2D"}}, "coefficients": {"$ref": "#/components/schemas/DistortionCoefficients"}}},
        }
    },
    "paths": {
        "/api/config": {"get": {"summary": "Get full scene config", "description": "Returns complete current application state together with UI-like fields and export payloads.", "responses": {"200": {"description": "Current scene, scanner, camera, simulation and UI configuration.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ConfigResponse"}}}}}}},
        "/api/grid/params": {
            "get": {"summary": "Get grid params JSON", "description": "Returns the same scene/grid export structure that the GUI exports as JSON.", "responses": {"200": {"description": "Current grid export JSON.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/GridParams"}}}}}},
            "post": {"summary": "Store grid params JSON", "description": "Stores grid export parameters, image size and generated points.", "requestBody": {"required": True, "description": "Grid JSON in the same format as exported calibration grid.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/GridParams"}, "example": {"grid": {"cols": 6, "rows": 9}, "cross_size": 0.18, "image_size": {"width": 960, "height": 1280}, "points": [{"id": 0, "color_bgr": [0, 0, 255], "shifted": True, "position": [102.68969120300136, 130.58980190864736], "original_position": [164.82758620689657, 214.48275862068965], "shift_vector": [-62.13789500389521, -83.89295671204229]}], "shifted_point_id": 16}}}}, "responses": {"200": {"description": "Grid parameters stored.", "content": {"application/json": {"schema": {"type": "object", "properties": {"ok": {"type": "boolean"}, "grid": {"$ref": "#/components/schemas/GridParams"}}}}}}}}},
        "/api/camera/params": {
            "get": {"summary": "Get camera params JSON", "description": "Returns the same camera distortion JSON that the GUI exports.", "responses": {"200": {"description": "Current camera export JSON.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CameraParams"}}}}}},
            "post": {"summary": "Store camera params JSON", "description": "Stores virtual camera image size and lens distortion coefficients.", "requestBody": {"required": True, "description": "Camera intrinsic-like parameters and distortion coefficients.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CameraParams"}, "example": {"image_size": {"width": 960, "height": 1280}, "coefficients": {"k1": -0.12, "k2": 0.02, "p1": 0.0, "p2": 0.0, "k3": 0.0}}}}}, "responses": {"200": {"description": "Camera parameters stored.", "content": {"application/json": {"schema": {"type": "object", "properties": {"ok": {"type": "boolean"}, "camera": {"$ref": "#/components/schemas/CameraParams"}}}}}}}}},
        "/api/scan/params": {
            "get": {"summary": "Get scanner params JSON", "description": "Returns the same scanner distortion JSON that the GUI exports.", "responses": {"200": {"description": "Current scanner export JSON.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ScannerParams"}}}}}},
            "post": {"summary": "Store scanner params JSON", "description": "Stores scanner distortion mode, strength and OpenCV-style coefficients.", "requestBody": {"required": True, "description": "Scanner distortion parameters.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ScannerParams"}, "example": {"enabled": True, "distortion_type": "barrel", "strength": 0.34, "coefficients": {"k1": -0.34, "k2": 0.0612, "p1": 0.0, "p2": 0.0, "k3": -0.0136}}}}}, "responses": {"200": {"description": "Scanner parameters stored.", "content": {"application/json": {"schema": {"type": "object", "properties": {"ok": {"type": "boolean"}, "scanner": {"$ref": "#/components/schemas/ScannerParams"}}}}}}}}},
        "/api/grid/distort": {"post": {"summary": "Apply distortion to points", "description": "Applies OpenCV-style distortion to normalized 2D points.", "requestBody": {"required": True, "description": "Points and explicit coefficients for calculation.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/GridDistortRequest"}, "example": {"coefficients": {"k1": -0.3, "k2": 0.02, "p1": 0.0, "p2": 0.0, "k3": 0.0}, "points": [{"x": 0.2, "y": -0.1}]}}}}, "responses": {"200": {"description": "Distorted point list.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/GridDistortResponse"}}}}}}},
        "/api/camera": {
            "get": {"summary": "Get camera position", "description": "Returns orbit angles and resolved transform of the virtual camera.", "responses": {"200": {"description": "Current camera position and look-at target.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CameraPosition"}}}}}},
            "post": {"summary": "Set camera position", "description": "Updates orbit angles and transform of the virtual camera.", "requestBody": {"required": True, "description": "New camera orbit and transform values.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CameraPosition"}, "example": {"arc_angle": 0, "arc_elevation": 0, "position": {"x": 0.0, "y": 6.15, "z": 4.9}, "look_at": {"x": 0.0, "y": 0.48, "z": 0.0}}}}}, "responses": {"200": {"description": "Camera position stored.", "content": {"application/json": {"schema": {"type": "object", "properties": {"ok": {"type": "boolean"}, "camera_position": {"$ref": "#/components/schemas/CameraPosition"}}}}}}}},
        },
        "/api/snapshot": {"post": {"summary": "Create snapshot from base64 image", "description": "Stores a PNG snapshot received as a data URL.", "requestBody": {"required": True, "description": "PNG image upload payload.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SnapshotUpload"}, "example": {"image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."}}}}, "responses": {"201": {"description": "Snapshot created.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SnapshotCreated"}}}}, "400": {"description": "image_base64 was not provided.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}}}}},
        "/api/snapshot/{id}": {
            "get": {"summary": "Get snapshot by id", "description": "Returns a saved PNG snapshot.", "parameters": [{"name": "id", "in": "path", "required": True, "description": "Snapshot identifier returned by POST /api/snapshot.", "schema": {"type": "string"}}], "responses": {"200": {"description": "PNG image binary.", "content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}, "404": {"description": "Snapshot not found.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}}}},
            "delete": {"summary": "Delete snapshot by id", "description": "Deletes a stored PNG snapshot.", "parameters": [{"name": "id", "in": "path", "required": True, "description": "Snapshot identifier returned by POST /api/snapshot.", "schema": {"type": "string"}}], "responses": {"200": {"description": "Snapshot deleted.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/StatusResponse"}}}}, "404": {"description": "Snapshot not found.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}}}},
        },
        "/api/run": {"get": {"summary": "Start simulation", "description": "Sets simulation state to running.", "responses": {"200": {"description": "Simulation started.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/StatusResponse"}}}}}}},
        "/api/pause": {"get": {"summary": "Pause simulation", "description": "Sets simulation state to paused.", "responses": {"200": {"description": "Simulation paused.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/StatusResponse"}}}}}}},
        "/api/reset": {"get": {"summary": "Reset simulation", "description": "Stops the simulation and signals reset to the frontend.", "responses": {"200": {"description": "Simulation reset.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/StatusResponse"}}}}}}},
        "/api/speed": {"get": {"summary": "Get or set speed via query ?value=", "description": "Returns current simulation speed. If value is provided, updates speed before returning it.", "parameters": [{"name": "value", "in": "query", "required": False, "description": "Optional new simulation speed multiplier.", "schema": {"type": "number"}}], "responses": {"200": {"description": "Current speed.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/StatusResponse"}}}}, "400": {"description": "Invalid numeric value.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}}}}},
    },
}


class ApiHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def _send_json(self, payload: Dict[str, Any], status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, file_path: Path, content_type: str | None = None) -> None:
        data = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or mimetypes.guess_type(str(file_path))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/api/config":
            self._send_json(APP_STATE.config())
            return
        if path == "/api/grid/params":
            self._send_json(APP_STATE.grid_params)
            return
        if path == "/api/camera/params":
            self._send_json(APP_STATE.camera_params)
            return
        if path == "/api/scan/params":
            self._send_json(APP_STATE.scan_params)
            return
        if path == "/openapi.json":
            self._send_json(OPENAPI_SPEC)
            return
        if path == "/api/camera":
            self._send_json(APP_STATE.camera_position)
            return
        if path == "/api/run":
            APP_STATE.running = True
            self._send_json({"running": APP_STATE.running, "speed": APP_STATE.speed, "ui": APP_STATE.ui_state()})
            return
        if path == "/api/pause":
            APP_STATE.running = False
            self._send_json({"running": APP_STATE.running, "speed": APP_STATE.speed, "ui": APP_STATE.ui_state()})
            return
        if path == "/api/reset":
            APP_STATE.running = False
            self._send_json({"running": APP_STATE.running, "reset": True, "speed": APP_STATE.speed, "ui": APP_STATE.ui_state()})
            return
        if path == "/api/speed":
            if "value" in query:
                try:
                    APP_STATE.speed = float(query["value"][0])
                except ValueError:
                    self._send_json({"error": "Invalid speed value"}, HTTPStatus.BAD_REQUEST)
                    return
            self._send_json({"speed": APP_STATE.speed, "running": APP_STATE.running, "ui": APP_STATE.ui_state()})
            return
        if path.startswith("/api/snapshot/"):
            snapshot_id = path.rsplit("/", 1)[-1]
            snapshot_path = SNAPSHOT_DIR / f"{snapshot_id}.png"
            if not snapshot_path.exists():
                self._send_json({"error": "Snapshot not found"}, HTTPStatus.NOT_FOUND)
                return
            self._send_file(snapshot_path, "image/png")
            return
        if path == "/docs":
            self.path = "/docs.html"
            return super().do_GET()
        if path == "/" or path == "":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        payload = self._read_json()
        if path == "/api/grid/params":
            APP_STATE.grid_params = payload
            self._send_json({"ok": True, "grid": APP_STATE.grid_params})
            return
        if path == "/api/camera/params":
            APP_STATE.camera_params = payload
            self._send_json({"ok": True, "camera": APP_STATE.camera_params})
            return
        if path == "/api/scan/params":
            APP_STATE.scan_params = payload
            self._send_json({"ok": True, "scanner": APP_STATE.scan_params})
            return
        if path == "/api/grid/distort":
            coefficients = payload.get("coefficients", APP_STATE.scan_params.get("coefficients", {}))
            distorted_points: List[Dict[str, float]] = []
            for point in payload.get("points", []):
                if isinstance(point, dict):
                    x = float(point.get("x", 0.0))
                    y = float(point.get("y", 0.0))
                else:
                    x = float(point[0])
                    y = float(point[1])
                distorted_points.append(apply_opencv_distortion(x, y, coefficients))
            self._send_json({"points": distorted_points, "coefficients": coefficients})
            return
        if path == "/api/camera":
            APP_STATE.camera_position = payload
            self._send_json({"ok": True, "camera_position": APP_STATE.camera_position, "ui": APP_STATE.ui_state()})
            return
        if path == "/api/snapshot":
            image_base64 = payload.get("image_base64")
            if not image_base64:
                self._send_json({"error": "image_base64 is required"}, HTTPStatus.BAD_REQUEST)
                return
            snapshot_id = payload.get("id") or str(uuid.uuid4())
            encoded = image_base64.split(",", 1)[-1]
            snapshot_path = SNAPSHOT_DIR / f"{snapshot_id}.png"
            snapshot_path.write_bytes(base64.b64decode(encoded))
            APP_STATE.last_snapshot_id = snapshot_id
            self._send_json({"id": snapshot_id, "path": f"/api/snapshot/{snapshot_id}", "ui": APP_STATE.ui_state()}, HTTPStatus.CREATED)
            return
        self._send_json({"error": f"Unknown route: {path}"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api/snapshot/"):
            snapshot_id = path.rsplit("/", 1)[-1]
            snapshot_path = SNAPSHOT_DIR / f"{snapshot_id}.png"
            if not snapshot_path.exists():
                self._send_json({"error": "Snapshot not found"}, HTTPStatus.NOT_FOUND)
                return
            snapshot_path.unlink()
            if APP_STATE.last_snapshot_id == snapshot_id:
                APP_STATE.last_snapshot_id = None
            self._send_json({"deleted": snapshot_id, "ui": APP_STATE.ui_state()})
            return
        self._send_json({"error": f"Unknown route: {path}"}, HTTPStatus.NOT_FOUND)


def run_server() -> None:
    host = os.environ.get("SLM_API_HOST", "127.0.0.1")
    port = int(os.environ.get("SLM_API_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), ApiHandler)
    print(f"Serving SLM app on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
