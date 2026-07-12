import { Router } from "express";
import getModelList from "./getModelList";
import getModelDetail from "./getModelDetail";

const router = Router();
router.get("/getModelList", getModelList);
router.get("/getModelDetail", getModelDetail);

export default router;
