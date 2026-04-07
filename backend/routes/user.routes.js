import express from "express";
import {
  askToAssistant,
  getCurrentUser,
  updateAssistant,
  whatsappInit,
  whatsappStatus
} from "../controllers/user.controllers.js";
import isAuth from "../middlewares/isAuth.js";
import upload from "../middlewares/multer.js";

const userRouter = express.Router();

userRouter.get("/current", isAuth, getCurrentUser);
userRouter.post("/update", isAuth, upload.single("assistantImage"), updateAssistant);
userRouter.post("/asktoassistant", isAuth, askToAssistant);

// WhatsApp status + init routes (no auth needed for init check)
userRouter.get("/whatsapp/status", isAuth, whatsappStatus);
userRouter.post("/whatsapp/init", isAuth, whatsappInit);

export default userRouter;
