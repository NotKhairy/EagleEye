import cv2
from detection.detector import ObjectDetector
from detection.zone_logic import ZoneManager


# Process detection every Nth frame (1 = every frame, 2 = every other frame).
FRAME_SKIP = 2


def main():
    """Main application loop"""
    # Initialize components
    detector = ObjectDetector(model_path="yolov8n.pt", confidence=0.3)
    zone_manager = ZoneManager(config_path="config/zone_config.json")
    cap = cv2.VideoCapture("videos/guyParkingCar.mp4")  # 0 is webcam

    if not cap.isOpened():
        print("Could not open video source")
        return
    
    # Setup window and mouse callback
    window_name = "EagleEye Detection"
    cv2.namedWindow(window_name)
    cv2.setMouseCallback(window_name, zone_manager.mouse_callback)
    
    print("EagleEye started. Left-click points to draw polygon, click first point again to close. Press Esc to cancel draft polygon.")

    frame_index = 0
    tracked_objects = []
    
    while True:
        ret, frame = cap.read()
        if not ret:
            print("End of video or failed to grab frame")
            break

        frame_index += 1
        
        # Perform detection/tracking
        if frame_index % FRAME_SKIP == 0:
            tracked_objects = detector.track(frame)
        annotated_frame = detector.draw_tracks(frame, tracked_objects, font_scale=0.4, line_width=1)
        
        # Check if matching objects are in any zones
        any_zone_triggered = detector.check_objects_in_zones(tracked_objects, zone_manager)
        
        # Draw all zones on frame
        zone_manager.draw_zones(annotated_frame)
        
        # Add UI elements
        draw_ui(annotated_frame, zone_manager, any_zone_triggered)
        
        # Display frame
        cv2.imshow(window_name, annotated_frame)
        
        # Handle keyboard input
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == 27:  # Esc
            zone_manager.cancel_current_polygon()
        elif key == ord("c"):
            zone_manager.clear_all_zones()
            print("All zones cleared")
    
    # Cleanup
    cap.release()
    cv2.destroyAllWindows()


def draw_ui(frame, zone_manager, any_zone_triggered):
    """Draw UI elements on frame"""
    # Instructions
    instructions = "Left-click: Add point/close polygon | Esc: Cancel draft | Right-click: Delete | 'c': Clear all | 'q': Quit"
    cv2.putText(frame, instructions, (10, 30), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    
    # Status information
    zone_count = len(zone_manager.zones)
    triggered_count = sum(1 for z in zone_manager.zones if z["triggered"])
    status = f"Zones: {zone_count} | Triggered: {triggered_count}"
    cv2.putText(frame, status, (10, 60), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)


if __name__ == "__main__":
    main()