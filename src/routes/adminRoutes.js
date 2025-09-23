// routes/admin.js
import express from "express";
import User from "../models/User";

const router = express.Router();

// Lấy danh sách user
router.get("/users", async (req, res) => {
  try {
    const users = await User.find({}, "name email role"); // chỉ lấy các field cần
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Lỗi server" });
  }
});

export default router;
