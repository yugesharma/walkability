from fastapi import FastAPI, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import cv2
import numpy as np
from ultralytics import YOLO
import matplotlib.pyplot as plt
import json
from pathlib import Path

app = FastAPI()
model = YOLO('yolov8n.pt') 

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

RESULTS_DIR = Path("results")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
LATEST_RESULT_PATH = RESULTS_DIR / "result.jpg"

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/latest-result")
def latest_result():
    if not LATEST_RESULT_PATH.exists():
        return {"error": "No result yet"}
    return FileResponse(str(LATEST_RESULT_PATH), media_type="image/jpeg")

@app.post("/upload")
def upload(file: bytes = File(...)):
    nparr=np.frombuffer(file, np.uint8)
    img=cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    results=model.predict(img, conf=0.5)
    
    count, score = calculate_score_per_frame(results)
    json_results = results[0].to_json()

    results[0].save(filename=str(LATEST_RESULT_PATH))
    return {"score": score, "count": count, "latest_result_url": "/latest-result"}


    

def calculate_score_per_frame(results):
    score =5
    for result in results:
        xywh = result.boxes.xywh  # center-x, center-y, width, height
        xywhn = result.boxes.xywhn  # normalized
        xyxy = result.boxes.xyxy  # top-left-x, top-left-y, bottom-right-x, bottom-right-y
        xyxyn = result.boxes.xyxyn  # normalized
        names = [result.names[cls.item()] for cls in result.boxes.cls.int()]  # class name of each box
        confs = result.boxes.conf  # confidence score of each box
    print("--------------------------------")
    print(xywh)
    print(xywhn)
    print(xyxy)
    print(xyxyn)
    print(names)
    print(confs)
    target_classes={'tree':3, 'lamp':2, 'dog':5, 'bicycle':2, 'bench':4,'traffic light':-3, 'car':-1, 'truck':-2}
    count= {}
    for name in names:
        if name in target_classes:
            count[name] = count.get(name, 0) + 1
    score += sum(count.get(name, 0) * target_classes[name] for name in count)
    return count, score
