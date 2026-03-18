## Walkability Camera Scorer

This project combines a FastAPI backend with a browser-based camera client to **capture live webcam frames, run YOLOv8 object detection, and compute a simple walkability score** based on detected streetscape elements (e.g. trees, benches, cars, traffic lights). The frontend (`Sketch Cam Uploader`) periodically uploads frames to the `/upload` endpoint, and the backend returns a score, counts of detected objects, and serves the latest annotated image for visualization.
