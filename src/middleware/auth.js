import jwt from "jsonwebtoken";
import User from "../models/user.js";

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Chưa có token" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token không hợp lệ" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded) return res.status(401).json({ message: "Token không hợp lệ" });

    req.user = decoded; // ⚠️ Phải gán vào req.user
    next();
  } catch (err) {
    return res.status(403).json({ message: "Token không hợp lệ" });
  }
};

// Middleware kiểm tra role
export const verifyRole = (roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Chưa đăng nhập" });
  if (!roles.includes(req.user.role))
    return res.status(403).json({ message: "Bạn không có quyền truy cập" });
  next();
};
