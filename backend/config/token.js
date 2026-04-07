import jwt from "jsonwebtoken"

const isProduction = process.env.NODE_ENV === "production"

export const signToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "10d" })

export const getAuthCookieOptions = () => ({
  httpOnly: true,
  sameSite: isProduction ? "none" : "lax",
  secure: isProduction,
  maxAge: 10 * 24 * 60 * 60 * 1000,
  path: "/",
})

export const clearAuthCookieOptions = () => ({
  httpOnly: true,
  sameSite: isProduction ? "none" : "lax",
  secure: isProduction,
  path: "/",
})

const genToken = async (userId) => signToken(userId)

export default genToken
