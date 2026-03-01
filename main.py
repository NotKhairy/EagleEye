from ultralytics import YOLO
import cv2
import time

model = YOLO("yolov8n.pt")
cap = cv2.VideoCapture(0) #0 is webcam

zone = (50,50,200,200)


def in_zone(xy,zone):
    x1, y1, x2, y2 = zone
    return x1 <= xy.x <= x2 and y1 <= xy.y <=y2

def getBoxCenter(arr):
    x = (arr[0][0]+arr[0][2])/2
    y = (arr[0][1]+arr[0][3])/2
    return x, y 

while True:
    ret, frame = cap.read()
    if not ret:
        print("Failed to grab frame")
        break

    results = model(frame)
    annotated_frame = results[0].plot()


    print(results[0].boxes.xyxy)
    boxCenter = getBoxCenter(results[0].boxes.xyxy)
    print(boxCenter)
    if in_zone(boxCenter, zone):
        cv2.rectangle(frame, (100,100), (400,400), (255,0,0), 2)
    else:
        cv2.rectangle(frame, (100,100), (400,400), (0,255,0), 2)

    cv2.imshow("Detection", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()