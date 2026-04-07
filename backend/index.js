import express from "express"
import dotenv from "dotenv"
dotenv.config()
import connectDb from "./config/db.js"
import authRouter from "./routes/auth.routes.js"
import cors from "cors"
import cookieParser from "cookie-parser"
import userRouter from "./routes/user.routes.js"
import geminiResponse from "./gemini.js"


const app=express()
app.use(cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials:true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}))

const port=process.env.PORT || 5000
app.use(express.json())
app.use(cookieParser())
app.use("/api/auth",authRouter)
app.use("/api/user",userRouter)


app.listen(port, () => {
    connectDb()
    console.log("server start ho chuka hai")
}).setTimeout(120000)  // 120 s — WhatsApp Puppeteer automation ke liye

