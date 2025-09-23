import jwt from "jsonwebtoken";
import User from "../models/tempUser.js";

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ message: "Chưa có token" });

  const token = authHeader.split(" ")[1]; // Bearer token
  if (!token) return res.status(401).json({ message: "Token không hợp lệ" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    next();
  } catch (err) {
    res.status(403).json({ message: "Token không hợp lệ hoặc hết hạn" });
  }
};

// Middleware kiểm tra role
export const verifyRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Không có quyền truy cập" });
  }
  next();
};
