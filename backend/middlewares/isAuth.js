import jwt from "jsonwebtoken"

const extractBearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization
  if (!header || typeof header !== "string") return null

  const [scheme, token] = header.split(" ")
  if (scheme !== "Bearer" || !token) return null

  return token.trim()
}

const isAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.token || extractBearerToken(req)

    if (!token) {
      return res.status(401).json({
        message: "Authentication required. Please sign in again.",
      })
    }

    const verifyToken = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = verifyToken.userId

    return next()
  } catch (error) {
    console.log("[Auth] Middleware error:", error.message)

    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Your session is invalid or expired. Please sign in again.",
      })
    }

    return res.status(500).json({
      message: "Unable to validate authentication right now.",
    })
  }
}

export default isAuth
