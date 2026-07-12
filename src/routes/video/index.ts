import { Router } from "express";
import uploadVideo from "./uploadVideo";
import analyzeVideo from "./analyzeVideo";
import segmentVideo from "./segmentVideo";

const router = Router();
router.post("/uploadVideo", uploadVideo);
router.post("/analyzeVideo", analyzeVideo);
router.post("/segmentVideo", segmentVideo);

export default router;
