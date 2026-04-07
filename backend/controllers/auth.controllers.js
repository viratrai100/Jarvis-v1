import bcrypt from "bcryptjs"
import User from "../models/user.model.js"
import {
  clearAuthCookieOptions,
  getAuthCookieOptions,
  signToken,
} from "../config/token.js"

const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  assistantName: user.assistantName || "",
  assistantImage: user.assistantImage || "",
  history: Array.isArray(user.history) ? user.history : [],
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
})

const setSessionCookie = (res, userId) => {
  const token = signToken(userId)
  res.cookie("token", token, getAuthCookieOptions())
  return token
}

export const signUp = async (req, res) => {
  try {
    const { name, email, password } = req.body

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const existEmail = await User.findOne({ email: normalizedEmail })
    if (existEmail) {
      return res.status(409).json({ message: "An account with this email already exists." })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long." })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
    })

    setSessionCookie(res, user._id)
    return res.status(201).json({
      message: "Account created successfully.",
      user: sanitizeUser(user),
    })
  } catch (error) {
    console.log("[Auth] Signup error:", error)
    return res.status(500).json({ message: "Unable to complete sign up right now." })
  }
}

export const Login = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email?.trim() || !password) {
      return res.status(400).json({ message: "Email and password are required." })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const user = await User.findOne({ email: normalizedEmail })
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." })
    }

    setSessionCookie(res, user._id)
    return res.status(200).json({
      message: "Signed in successfully.",
      user: sanitizeUser(user),
    })
  } catch (error) {
    console.log("[Auth] Login error:", error)
    return res.status(500).json({ message: "Unable to sign in right now." })
  }
}

export const logOut = async (req, res) => {
  try {
    res.clearCookie("token", clearAuthCookieOptions())
    return res.status(200).json({ message: "Logged out successfully." })
  } catch (error) {
    console.log("[Auth] Logout error:", error)
    return res.status(500).json({ message: "Unable to log out right now." })
  }
}
