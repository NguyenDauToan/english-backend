// src/middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/user.js";

export const verifyToken = async (req, res, next) => {
  try {
    const h = req.headers.authorization || req.headers.Authorization;
    if (!h || !h.startsWith("Bearer "))
      return res.status(401).json({ message: "Thiếu token" });

    const token = h.split(" ")[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ message: "Token đã hết hạn, vui lòng đăng nhập lại" });
      }
      return res.status(401).json({ message: "Token không hợp lệ" });
    }

    const userId = decoded.id || decoded._id || decoded.userId;
    if (!userId) return res.status(401).json({ message: "Token không hợp lệ" });

    const user = await User.findById(userId).select("-password");
    if (!user)
      return res.status(401).json({ message: "Người dùng không tồn tại" });

    // cập nhật hoạt động gần đây (không chặn request nếu lỗi)
    User.updateOne(
      { _id: user._id },
      { $set: { lastActive: new Date() } }
    ).catch(() => {});

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Token không hợp lệ" });
  }
};

// ✅ chuẩn hóa role + log
export const verifyRole = (roles) => (req, res, next) => {
  if (!req.user)
    return res.status(401).json({ message: "Chưa đăng nhập" });

  const userRole = (req.user.role || "").toLowerCase();
  const allowed = roles.map((r) => r.toLowerCase());

  console.log("verifyRole:", {
    email: req.user.email,
    role: userRole,
    required: allowed,
  });

  if (!allowed.includes(userRole)) {
    return res.status(403).json({ message: "Bạn không có quyền truy cập" });
  }

  next();
};

export const verifyTokenSocket = (token) => {
  try {
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (err) {
    console.error("Lỗi verifyTokenSocket:", err.message);
    return null;
  }
};
