import { Router } from "express";
import uploadVideo from "./uploadVideo";
import analyzeVideo from "./analyzeVideo";
import segmentVideo from "./segmentVideo";
import extractFrame from "./extractFrame";
import uploadGenerated from "./uploadGenerated";

const router = Router();
router.post("/uploadVideo", uploadVideo);
router.post("/analyzeVideo", analyzeVideo);
router.post("/segmentVideo", segmentVideo);
router.post("/extractFrame", extractFrame);
router.post("/uploadGenerated", uploadGenerated);

export default router;
