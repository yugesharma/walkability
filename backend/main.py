from datetime import datetime
import threading
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from io import BytesIO
import cv2
import numpy as np
from ultralytics import YOLO
import matplotlib.pyplot as plt
import json
from pathlib import Path
import torch
from transformers import SegformerImageProcessor, SegformerForSemanticSegmentation
from PIL import Image
import sqlite3
DB_PATH = str(Path(__file__).resolve().parent / "walks.db")
ACTIVE_WALK_ID = None
ACTIVE_WALK_LOCK = threading.Lock()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def now_local_iso() -> str:
    # Stores local time
    return datetime.now().astimezone().isoformat(timespec="seconds")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(
            '''
CREATE TABLE IF NOT EXISTS walks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT
);

CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  walk_id INTEGER,
  lat REAL,
  lng REAL,
  score INTEGER,
  timestamp TEXT,
  FOREIGN KEY (walk_id) REFERENCES walks(id)
);
'''
        )
        conn.commit()
    finally:
        conn.close()

init_db()




@app.post("/start-walk")
def start_walk(
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    accuracy: float | None = Form(None),
):
    started_at = now_local_iso()

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        cur = conn.cursor()

        cur.execute("INSERT INTO walks (started_at) VALUES (?)", (started_at,))
        walk_id = cur.lastrowid

        global ACTIVE_WALK_ID
        with ACTIVE_WALK_LOCK:
            ACTIVE_WALK_ID = walk_id

        if lat is not None and lng is not None:
            cur.execute(
                "INSERT INTO frames (walk_id, lat, lng, score, timestamp) VALUES (?, ?, ?, ?, ?)",
                (walk_id, lat, lng, None, started_at),
            )

        conn.commit()
    finally:
        conn.close()

    return {
        "walk_id": walk_id,
        "started_at": started_at,
        "location": {"lat": lat, "lng": lng, "accuracy": accuracy},
    }


@app.post("/stop-walk")
def stop_walk():
    global ACTIVE_WALK_ID
    with ACTIVE_WALK_LOCK:
        ACTIVE_WALK_ID = None
    return {"ok": True}


@app.get("/walks")
def list_walks():
    # "Completed" walks 
    with ACTIVE_WALK_LOCK:
        active_id = ACTIVE_WALK_ID

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        cur = conn.cursor()

        cur.execute(
            '''
            SELECT
                w.id,
                w.started_at,
                AVG(f.score) AS avg_score,
                COUNT(f.score) AS scored_frames
            FROM walks w
            LEFT JOIN frames f ON f.walk_id = w.id
            WHERE (? IS NULL OR w.id != ?)
            GROUP BY w.id
            ORDER BY w.id DESC
            ''',
            (active_id, active_id),
        )
        rows = cur.fetchall()

        cur.execute(
            '''
            SELECT
                SUM(score) AS sum_scores,
                COUNT(score) AS scored_frames
            FROM frames f
            JOIN walks w ON w.id = f.walk_id
            WHERE (? IS NULL OR w.id != ?)
            ''',
            (active_id, active_id),
        )
        sum_scores, total_scored_frames = cur.fetchone()
        overall_avg = None
        if total_scored_frames and total_scored_frames > 0 and sum_scores is not None:
            overall_avg = float(sum_scores) / float(total_scored_frames)

        walks = [
            {
                "walk_id": int(wid),
                "started_at": started_at,
                "average_score": None if avg_score is None else float(avg_score),
                "scored_frames": int(scored_frames),
            }
            for (wid, started_at, avg_score, scored_frames) in rows
        ]

        return {
            "active_walk_id": active_id,
            "overall_average_score": overall_avg,
            "walks": walks,
        }
    finally:
        conn.close()


@app.get("/walks/{walk_id}/route")
def get_walk_route(walk_id: int):
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        cur = conn.cursor()
        cur.execute(
            '''
            SELECT id, lat, lng, timestamp
            FROM frames
            WHERE walk_id = ?
              AND lat IS NOT NULL
              AND lng IS NOT NULL
            ORDER BY id ASC
            ''',
            (walk_id,),
        )
        rows = cur.fetchall()

        # Downsample if route gets too large
        max_points = 500
        points = [{"lat": float(r[1]), "lng": float(r[2])} for r in rows]
        if len(points) > max_points:
            step = (len(points) + max_points - 1) // max_points
            points = points[::step]

        return {"walk_id": walk_id, "points": points}
    finally:
        conn.close()


processor = SegformerImageProcessor.from_pretrained(
    "nvidia/segformer-b4-finetuned-cityscapes-1024-1024"
)
model = SegformerForSemanticSegmentation.from_pretrained(
    "nvidia/segformer-b4-finetuned-cityscapes-1024-1024"
).eval().to("cuda" if torch.cuda.is_available() else "cpu")


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
def upload(
    file: UploadFile = File(...),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    accuracy: float | None = Form(None),
):
    raw = file.file.read()
    if not raw:
        return {"error": "Empty upload"}

    image = Image.open(BytesIO(raw)).convert("RGB")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    inputs = processor(images=image, return_tensors="pt").to(device)

    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits  

    upsampled_logits = torch.nn.functional.interpolate(
    logits,
    size=image.size[::-1],  
    mode="bilinear",
    align_corners=False,
    )
    pred_seg = upsampled_logits.argmax(dim=1)[0].cpu().numpy()

    
    id2label = getattr(getattr(model, "config", None), "id2label", None) or {}
    inv_label_to_id = {str(v).lower(): int(k) for k, v in id2label.items() if str(v).strip() and str(k).isdigit()}

    def class_ratio(label_names):
        ids = [inv_label_to_id[name.lower()] for name in label_names if name.lower() in inv_label_to_id]
        if not ids:
            return 0.0
        mask = np.isin(pred_seg, np.array(ids, dtype=pred_seg.dtype))
        return float(mask.mean())

    sidewalk_ratio = class_ratio(["sidewalk"])
    green_ratio = class_ratio(["vegetation", "terrain"])
    vehicle_ratio = class_ratio(["car", "truck", "bus", "motorcycle"])
    sky_ratio = class_ratio(["sky"])
    score_raw = (175 * sidewalk_ratio) + (100 * green_ratio) - (250 * vehicle_ratio) + (100 * sky_ratio * (1 - vehicle_ratio))
    score = int(round(max(0, min(100, score_raw))))

    ts = now_local_iso()
    with ACTIVE_WALK_LOCK:
        walk_id = ACTIVE_WALK_ID
    if walk_id is not None:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO frames (walk_id, lat, lng, score, timestamp) VALUES (?, ?, ?, ?, ?)",
                (walk_id, lat, lng, score, ts),
            )
            conn.commit()
        finally:
            conn.close()

    # Visualization
    pred_u8 = pred_seg.astype(np.float32)
    if pred_u8.max() > 0:
        pred_u8 = (pred_u8 / pred_u8.max()) * 255.0
    pred_u8 = pred_u8.astype(np.uint8)

    heat = cv2.applyColorMap(pred_u8, cv2.COLORMAP_JET)  # BGR
    img_np = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    blended = cv2.addWeighted(img_np, 0.65, heat, 0.35, 0)

    if lat is not None and lng is not None:
        cv2.putText(
            blended,
            f"{lat:.5f}, {lng:.5f}",
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

    cv2.imwrite(str(LATEST_RESULT_PATH), blended)

    return {
        "score": score,
        "count": {
            "sidewalk_ratio": sidewalk_ratio,
            "vegetation_ratio": green_ratio,
            "vehicle_ratio": vehicle_ratio,
        },
        "latest_result_url": "/latest-result",
        "location": {"lat": lat, "lng": lng, "accuracy": accuracy},
    }
