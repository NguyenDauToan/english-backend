// src/middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/user.js";

/**
 * Middleware xác thực cho HTTP (Express)
 */
export const verifyToken = async (req, res, next) => {
  try {
    const h = req.headers.authorization || req.headers.Authorization;
    if (!h || !h.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Thiếu token" });
    }

    const token = h.split(" ")[1];
    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("verifyToken jwt error:", err.name, err.message);
      if (err.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ message: "Token đã hết hạn, vui lòng đăng nhập lại" });
      }
      return res.status(401).json({ message: "Token không hợp lệ" });
    }

    const userId = decoded.id || decoded._id || decoded.userId;
    if (!userId) {
      return res.status(401).json({ message: "Token không hợp lệ" });
    }

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(401).json({ message: "Người dùng không tồn tại" });
    }

    // ✅ CHẶN NẾU TÀI KHOẢN ĐÃ BỊ KHÓA
    if (user.isActive === false) {
      return res.status(403).json({
        message: "Tài khoản đã bị chặn, vui lòng liên hệ quản trị viên",
      });
    }

    // cập nhật hoạt động gần đây (không chặn request nếu lỗi)
    User.updateOne(
      { _id: user._id },
      { $set: { lastActive: new Date() } }
    ).catch((e) => {
      console.warn("update lastActive error:", e.message);
    });

    req.user = user;
    req.userId = String(user._id);
    req.userRole = user.role;

    next();
  } catch (err) {
    console.error("verifyToken outer error:", err.message);
    return res.status(401).json({ message: "Token không hợp lệ" });
  }
};


/**
 * Kiểm tra quyền theo role
 */
export const verifyRole = (roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Chưa đăng nhập" });
  }

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

/**
 * Xác thực token dùng cho Socket (Socket.IO, WebSocket,...)
 * Trả về user đầy đủ (không có password) hoặc null.
 * LƯU Ý: hàm này là async, nhớ await khi dùng.
 */
export const verifyTokenSocket = (token) => {
  try {
    if (!token) return null;

    // Nếu gửi dạng "Bearer xxx" thì cắt bỏ
    const raw = token.startsWith("Bearer ") ? token.slice(7) : token;

    const decoded = jwt.verify(raw, process.env.JWT_SECRET);
    if (!decoded) return null;

    return decoded; // payload JWT (chứa id/_id/userId, role,...)
  } catch (err) {
    console.error("Lỗi verifyTokenSocket:", err.message);
    return null;
  }
};
