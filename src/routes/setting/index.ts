import { Router } from "express";
import getSetting from "./getSetting";
import updateSetting from "./updateSetting";

const router = Router();
router.get("/getSetting", getSetting);
router.put("/updateSetting", updateSetting);

export default router;
