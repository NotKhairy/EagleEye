import cv2
import json
import math
import numpy as np


class ZoneManager:
    """Manages multiple zones - drawing, loading, and saving"""
    
    def __init__(self, config_path="config/zone_config.json"):
        self.config_path = config_path
        self.zones = []  # List of zone dictionaries
        self.current_polygon = []
        self.close_distance = 12
        self.load_zones()
    
    def load_zones(self):
        """Load all zones from config file"""
        try:
            with open(self.config_path, "r") as f:
                config = json.load(f)
                self.zones = []
                for zone_data in config:
                    if "coordinates" in zone_data:
                        coords = zone_data["coordinates"]
                        polygon = self._normalize_coordinates(coords)
                        if len(polygon) >= 3:
                            raw_trigger = zone_data.get("trigger", "Person")
                            self.zones.append({
                                "id": zone_data.get("zone_id", len(self.zones) + 1),
                                "name": zone_data.get("zone_name", f"Zone {len(self.zones) + 1}"),
                                "coordinates": polygon,
                                "trigger": self._normalize_trigger(raw_trigger),
                                "triggered": False,
                                "onTrigger": zone_data.get("onTrigger", "No action defined")
                            })
        except:
            self.zones = []
    
    def save_zones(self):
        """Save all zones to config file"""
        config = []
        for i, zone in enumerate(self.zones):
            trigger_value = zone["trigger"][0] if len(zone["trigger"]) == 1 else zone["trigger"]
            config.append({
                "zone_name": zone["name"],
                "zone_id": zone["id"],
                "description": "Detection zone",
                "trigger": trigger_value,
                "coordinates": list(zone["coordinates"])
            })
        
        with open(self.config_path, "w") as f:
            json.dump(config, f, indent=4)
    
    def add_zone(self, coordinates):
        """Add a new zone"""
        polygon = self._normalize_coordinates(coordinates)
        if len(polygon) < 3:
            return

        new_id = max([z["id"] for z in self.zones], default=0) + 1
        new_zone = {
            "id": new_id,
            "name": f"Zone {new_id}",
            "coordinates": polygon,
            "trigger": ["person"],
            "triggered": False
        }
        self.zones.append(new_zone)
        self.save_zones()
        print(f"Zone {new_id} created with {len(polygon)} points")
    
    def clear_all_zones(self):
        """Clear all zones"""
        self.zones = []
        self.save_zones()
        print("All zones cleared")

    def cancel_current_polygon(self):
        """Cancel the currently drawn polygon draft."""
        if self.current_polygon:
            self.current_polygon = []
            print("Polygon draft canceled")
    
    def delete_zone_at_point(self, point):
        """Delete zone that contains the given point"""
        for i, zone in enumerate(self.zones):
            if self._is_point_in_coordinates(point, zone["coordinates"]):
                deleted_name = zone["name"]
                self.zones.pop(i)
                self.save_zones()
                print(f"{deleted_name} deleted")
                return True
        return False
    
    def mouse_callback(self, event, x, y, flags, param):
        """Handle mouse events for polygon zone creation/deletion."""
        # Right click to delete zone
        if event == cv2.EVENT_RBUTTONDOWN:
            self.delete_zone_at_point((x, y))
            return

        if event == cv2.EVENT_LBUTTONDOWN:
            clicked_point = (x, y)

            # Close polygon when user clicks near the first point again.
            if len(self.current_polygon) >= 3 and self._is_close_to_first_point(clicked_point):
                self.add_zone(self.current_polygon)
                self.current_polygon = []
                return

            self.current_polygon.append(clicked_point)
    
    def _is_point_in_coordinates(self, point, coordinates):
        """Helper to check if point is in given coordinates"""
        polygon = self._coordinates_to_polygon(coordinates)
        if len(polygon) < 3:
            return False

        contour = self._polygon_to_contour(polygon)
        return cv2.pointPolygonTest(contour, point, False) >= 0

    def _normalize_coordinates(self, coordinates):
        """Normalize coordinates into a polygon [(x, y), ...] format."""
        if not coordinates:
            return []

        # Legacy rectangle format: [x1, y1, x2, y2]
        if isinstance(coordinates, (list, tuple)) and len(coordinates) == 4 and all(
            isinstance(c, (int, float)) for c in coordinates
        ):
            x1, y1, x2, y2 = coordinates
            x_min, x_max = int(min(x1, x2)), int(max(x1, x2))
            y_min, y_max = int(min(y1, y2)), int(max(y1, y2))
            return [(x_min, y_min), (x_max, y_min), (x_max, y_max), (x_min, y_max)]

        polygon = []
        for p in coordinates:
            if isinstance(p, (list, tuple)) and len(p) == 2:
                polygon.append((int(p[0]), int(p[1])))

        return polygon

    def _coordinates_to_polygon(self, coordinates):
        """Return polygon points from any supported coordinate format."""
        return self._normalize_coordinates(coordinates)

    def _polygon_to_contour(self, polygon):
        """Convert polygon points to OpenCV contour format."""
        return np.array(polygon, dtype=np.int32)

    def _is_close_to_first_point(self, point):
        """Check if a clicked point is near the first point of active polygon."""
        if not self.current_polygon:
            return False
        x1, y1 = self.current_polygon[0]
        x2, y2 = point
        return math.hypot(x2 - x1, y2 - y1) <= self.close_distance

    def _normalize_trigger(self, trigger):
        """Normalize trigger config into a lowercase label list."""
        if isinstance(trigger, list):
            values = trigger
        elif isinstance(trigger, str):
            # Accept formats like "Phone, Person" and "Phone and Person".
            prepared = trigger.replace(" and ", ",")
            values = [part.strip() for part in prepared.split(",")]
        else:
            values = []

        normalized = [value.lower() for value in values if value and value.strip()]
        return normalized or ["person"]

    def zone_matches_label(self, zone, label):
        """Check whether a zone should trigger for a given detected label."""
        return label.lower() in zone["trigger"]
    
    def check_point_in_zones(self, point):
        """Check which zones contain the point and update triggered status"""
        triggered_zones = []
        for zone in self.zones:
            if self._is_point_in_coordinates(point, zone["coordinates"]):
                triggered_zones.append(zone["id"])
        return triggered_zones
    
    def reset_triggers(self):
        """Reset all zone trigger states"""
        for zone in self.zones:
            zone["triggered"] = False
    
    def set_zone_triggered(self, zone_id, triggered=True):
        """Set triggered state for a specific zone"""
        for zone in self.zones:
            if zone["id"] == zone_id:
                zone["triggered"] = triggered
                break
    
    def draw_zones(self, frame):
        """Draw all zones on the frame"""
        for zone in self.zones:
            polygon = self._coordinates_to_polygon(zone["coordinates"])
            if len(polygon) < 3:
                continue

            # Red if triggered, green otherwise
            color = (0, 0, 255) if zone["triggered"] else (0, 255, 0)
            contour = self._polygon_to_contour(polygon)
            cv2.polylines(frame, [contour], True, color, 2)
            
            # Draw zone label
            trigger_text = "/".join(zone["trigger"])
            label = f"{zone['name']} ({trigger_text})"
            label_pos = (polygon[0][0] + 5, polygon[0][1] - 8)
            cv2.putText(frame, label, label_pos, cv2.FONT_HERSHEY_SIMPLEX, 
                       0.5, color, 2)

        # Draw active polygon being created.
        if len(self.current_polygon) > 0:
            for point in self.current_polygon:
                cv2.circle(frame, point, 4, (255, 255, 0), -1)

            if len(self.current_polygon) > 1:
                contour = self._polygon_to_contour(self.current_polygon)
                cv2.polylines(frame, [contour], False, (255, 255, 0), 2)

            # Highlight the first point so user knows where to click to close.
            cv2.circle(frame, self.current_polygon[0], self.close_distance, (0, 255, 255), 1)
