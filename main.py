from ultralytics import YOLO
import cv2
import time

model = YOLO("yolov8n.pt")
cap = cv2.VideoCapture(0) #0 is webcam

zone = (100, 100, 400, 400)


def in_zone(xy, zone):
    x, y = xy
    x1, y1, x2, y2 = zone
    return x1 <= x <= x2 and y1 <= y <= y2

def getBoxCenter(box):
    x = (box[0] + box[2]) / 2
    y = (box[1] + box[3]) / 2
    return x, y 

while True:
    ret, frame = cap.read()
    if not ret:
        print("Failed to grab frame")
        break

    # Use tracking instead of detection - smooths out boxes across frames
    results = model.track(frame, persist=True, verbose=False, conf=0.5)
    annotated_frame = results[0].plot()
    human_in_zone = False

    
    if len(results[0].boxes) > 0:
        for i, box in enumerate(results[0].boxes.xyxy):
            cls = int(results[0].boxes.cls[i])
            if cls == 0:  # Person class
                boxCenter = getBoxCenter(box)
                if in_zone(boxCenter, zone):
                    human_in_zone = True
                    break
    

    color = (0, 0, 255) if human_in_zone else (0, 255, 0)
    cv2.rectangle(annotated_frame, (100, 100), (400, 400), color, 2)
    cv2.imshow("Detection", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()