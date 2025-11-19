import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/user.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

// ---------------- Đăng ký ----------------
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email đã tồn tại" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
    });

    const token = jwt.sign(
      {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password: pw, ...userData } = newUser._doc;
    res
      .status(201)
      .json({ token, user: userData, message: "Đăng ký thành công" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------- Đăng nhập ----------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const foundUser = await User.findOne({ email });
    if (!foundUser) {
      return res.status(400).json({ message: "Email không tồn tại" });
    }

    // ✅ Kiểm tra trạng thái hoạt động

    const isMatch = await bcrypt.compare(password, foundUser.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Sai mật khẩu" });
    }

    const token = jwt.sign(
      {
        id: foundUser._id,
        name: foundUser.name,
        email: foundUser.email,
        role: foundUser.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password: pw, ...userData } = foundUser._doc;
    return res.json({ token, user: userData });
  } catch (err) {
    console.error("LOGIN ERROR (backend):", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
});

// ---------------- Lấy thông tin người dùng hiện tại ----------------
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ message: "Không có token" });

    const token = authHeader.split(" ")[1];
    if (!token)
      return res.status(401).json({ message: "Token không hợp lệ" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user)
      return res.status(404).json({ message: "Không tìm thấy user" });

    res.json({ user });
  } catch (err) {
    console.error("Lỗi xác thực:", err.message);
    res.status(401).json({ message: "Token hết hạn hoặc không hợp lệ" });
  }
});

// ---------------- Cập nhật thông tin người dùng ----------------
router.put("/update", verifyToken, async (req, res) => {
  try {
    const updateData = (({ name, grade, level, school, avatar }) => ({
      name,
      grade,
      level,
      school,
      avatar,
    }))(req.body);

    const updated = await User.findByIdAndUpdate(req.user.id, updateData, {
      new: true,
    }).select("-password");

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.post("/logout", (req, res) => {
  // Nếu có dùng cookie để lưu token
  res.clearCookie("token");
  // Phản hồi cho client biết đã đăng xuất thành công
  return res.status(200).json({ message: "Đăng xuất thành công" });
});
export default router;
