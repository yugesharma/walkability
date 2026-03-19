## Walkability real-time Scorer

This project combines a FastAPI backend with a browser-based camera client to capture live frames, run semantic segmentation (Fine-tuned SegFormer), and compute a simple walkability score.

## Major features (high level)
- Browser webcam UI that periodically captures frames and uploads them to the backend.
- Backend runs segmentation and computes a walkability score
- Geolocation tracking with each frame.
- Record walks + frame scores into SQLite.
- Completed walks summary along with each walk's route can be displayed 
