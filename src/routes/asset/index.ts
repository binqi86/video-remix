import { Router } from "express";
import uploadAsset from "./uploadAsset";
import getAsset from "./getAsset";
import deleteAsset from "./deleteAsset";

const router = Router();
router.post("/uploadAsset", uploadAsset);
router.get("/getAsset", getAsset);
router.delete("/deleteAsset", deleteAsset);

export default router;
