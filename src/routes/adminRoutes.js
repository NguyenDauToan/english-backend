// routes/admin.js
import express from "express";
import User from "../models/user.js";

const router = express.Router();

// Lấy danh sách user
router.get("/users", async (req, res) => {
  try {
    const users = await User.find({}, "name email role status"); // thêm status nếu cần

    // Lọc theo role
    const admins = users.filter(u => u.role === "admin");
    const teachers = users.filter(u => u.role === "teacher");
    const students = users.filter(u => u.role === "student");

    res.json({
      admins,
      teachers,
      students,
      all: users, // nếu muốn giữ cả list tổng hợp
    });
  } catch (err) {
    res.status(500).json({ message: "Lỗi server" });
  }
});


export default router;
