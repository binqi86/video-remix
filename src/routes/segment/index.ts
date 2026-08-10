import { Router } from "express";
import getSegments from "./getSegments";
import updateSegment from "./updateSegment";
import reorderSegment from "./reorderSegment";
import mergeSegments from "./mergeSegments";
import splitSegment from "./splitSegment";
import uploadSpeechAudio from "./uploadSpeechAudio";
import removeSpeechAudio from "./removeSpeechAudio";
import reorderSpeechAudio from "./reorderSpeechAudio";

const router = Router();
router.get("/getSegments", getSegments);
router.put("/updateSegment", updateSegment);
router.put("/reorderSegment", reorderSegment);
router.post("/mergeSegments", mergeSegments);
router.post("/splitSegment", splitSegment);
router.post("/uploadSpeechAudio", uploadSpeechAudio);
router.post("/removeSpeechAudio", removeSpeechAudio);
router.post("/reorderSpeechAudio", reorderSpeechAudio);

export default router;
