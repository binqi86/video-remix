import { Router } from "express";
import getSegments from "./getSegments";
import updateSegment from "./updateSegment";
import reorderSegment from "./reorderSegment";

const router = Router();
router.get("/getSegments", getSegments);
router.put("/updateSegment", updateSegment);
router.put("/reorderSegment", reorderSegment);

export default router;
