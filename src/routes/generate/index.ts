import { Router } from "express";
import startGeneration from "./startGeneration";
import generateImage from "./generateImage";
import generateVideo from "./generateVideo";
import stitchVideo from "./stitchVideo";
import cancelGeneration from "./cancelGeneration";

const router = Router();
router.post("/startGeneration", startGeneration);
router.post("/generateImage", generateImage);
router.post("/generateVideo", generateVideo);
router.post("/stitchVideo", stitchVideo);
router.post("/cancelGeneration", cancelGeneration);

export default router;
