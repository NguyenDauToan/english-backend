import express from "express";
import User from "../models/user.js";  // Model User bạn đã có

const router = express.Router();
export const onlineUsers = new Map(); // userId => true

// Lấy danh sách tài khoản
router.get("/", async (req, res) => {
  try {
    const users = await User.find().select("-password"); // ẩn mật khẩu
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Lỗi server khi lấy danh sách tài khoản" });
  }
});

// Lấy chi tiết 1 user
router.get("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "Không tìm thấy tài khoản" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Lỗi server khi lấy thông tin tài khoản" });
  }
});

// Tạo mới user
router.post("/", async (req, res) => {
  try {
    const { name, email, role } = req.body;
    const newUser = new User({ name, email, role, password: "123456" }); // default pass
    await newUser.save();
    res.json({ message: "Tạo tài khoản thành công", user: newUser });
  } catch (error) {
    res.status(500).json({ message: "Lỗi khi tạo tài khoản" });
  }
});

// Cập nhật user
router.put("/:id", async (req, res) => {
  try {
    const { name, email, role } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, role },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "Không tìm thấy tài khoản" });
    res.json({ message: "Cập nhật thành công", user });
  } catch (error) {
    res.status(500).json({ message: "Lỗi khi cập nhật tài khoản" });
  }
});

// Xóa user
router.delete("/:id", async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "Không tìm thấy tài khoản" });
    res.json({ message: "Xóa tài khoản thành công" });
  } catch (error) {
    res.status(500).json({ message: "Lỗi khi xóa tài khoản" });
  }
});
// PUT /api/admin/users/:id/active
router.put("/:id/active", async (req, res) => {
  try {
    const { isActive } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "Không tìm thấy tài khoản" });

    res.json(user); // trả về user mới đã update
  } catch (error) {
    res.status(500).json({ message: "Lỗi khi cập nhật trạng thái" });
  }
});

export default router;
