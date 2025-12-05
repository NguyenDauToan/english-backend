// src/routes/profile.js
import express from "express";
import bcrypt from "bcryptjs";          // 👈 thêm
import User from "../models/user.js";
import Classroom from "../models/classroom.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET /api/profile/me
 * Lấy thông tin profile cho giáo viên / school_manager đang đăng nhập
 */
router.get(
  "/me",
  verifyToken,
  async (req, res) => {
    try {
      const userId = req.user._id || req.user.id;

      const user = await User.findById(userId)
        .select("-password -__v")
        .populate("school", "name code address")
        .populate("classroom", "name code grade")
        .populate("classes", "name code grade");

      if (!user) {
        return res.status(404).json({ message: "Không tìm thấy người dùng" });
      }

      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        grade: user.grade,
        school: user.school,
        classroom: user.classroom,
        classes: user.classes,
        avatarUrl: user.avatarUrl || "",
        lastActive: user.lastActive,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (err) {
      console.error("Lỗi lấy profile:", err);
      return res.status(500).json({ message: "Lỗi server khi lấy profile" });
    }
  }
);

/**
 * PUT /api/profile/me
 * Cập nhật profile cho giáo viên / school_manager
 * Chỉ cho sửa: name, avatarUrl, password
 */
router.put(
  "/me",
  verifyToken,
  verifyRole(["teacher", "school_manager"]),
  async (req, res) => {
    try {
      const userId = req.user._id || req.user.id;
      const {
        name,
        avatarUrl,
        currentPassword,
        newPassword,
      } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "Không tìm thấy người dùng" });
      }

      // 1. Cập nhật tên
      if (typeof name === "string" && name.trim()) {
        user.name = name.trim();
      }

      // 2. Cập nhật avatar
      if (typeof avatarUrl === "string") {
        user.avatarUrl = avatarUrl.trim();
      }

      // 3. Đổi mật khẩu (nếu có newPassword)
      if (newPassword) {
        if (!currentPassword) {
          return res
            .status(400)
            .json({ message: "Vui lòng nhập mật khẩu hiện tại" });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
          return res
            .status(400)
            .json({ message: "Mật khẩu hiện tại không đúng" });
        }

        if (newPassword.length < 6) {
          return res.status(400).json({
            message: "Mật khẩu mới phải có ít nhất 6 ký tự",
          });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
      }

      // KHÔNG cho update grade, school, classroom ở đây
      // => bỏ toàn bộ xử lý grade / classroomId

      await user.save();

      const updated = await User.findById(user._id)
        .select("-password -__v")
        .populate("school", "name code address")
        .populate("classroom", "name code grade")
        .populate("classes", "name code grade");

      return res.json({
        message: "Cập nhật thông tin tài khoản thành công",
        user: updated,
      });
    } catch (err) {
      console.error("Lỗi cập nhật profile:", err);
      return res
        .status(500)
        .json({ message: "Lỗi server khi cập nhật profile" });
    }
  }
);

export default router;
